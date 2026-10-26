"""AQx–Tirole Omega — Flask interface.

A thin, transparent HTTP layer over the original CLI analysis. No market data is
fetched, no recommendation is produced, and every number the interface shows can
be traced back to the scoring function in ``aqx_tirole_omega.py``.

Run locally:
    pip install -r requirements.txt
    python app.py                    # http://localhost:5000
"""

from __future__ import annotations

import io
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, Response, jsonify, render_template, request

from aqx_tirole_omega import (
    SCREEN_BANDS,
    WEIGHTS,
    monte_carlo_terminal_values,
    normalize_weights,
    score_universe,
)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
APP_VERSION = "1.2.0"
FACTOR_KEYS = list(WEIGHTS)
MAX_ROWS = 250
MAX_UPLOAD_BYTES = 2 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
app.config["JSON_SORT_KEYS"] = False

# --------------------------------------------------------------------------- #
# Domain metadata — one source of truth for both languages.
# --------------------------------------------------------------------------- #

FACTOR_META = [
    {
        "key": "competition",
        "name": {"en": "Competitive strength", "fa": "قدرت رقابتی"},
        "short": {"en": "Competition", "fa": "رقابت"},
        "hint": {
            "en": "Durability of the company's advantage: pricing power, barriers to entry, market position.",
            "fa": "پایداری مزیت رقابتی: قدرت قیمتگذاری، موانع ورود و جایگاه بازار.",
        },
        "question": {
            "en": "What evidence would lower this score? A new competitor, falling margins, or a lost contract?",
            "fa": "چه شواهدی این امتیاز را کاهش میدهد؟ رقیب تازه، کاهش حاشیه سود یا از دست رفتن قرارداد؟",
        },
    },
    {
        "key": "valuation",
        "name": {"en": "Valuation appeal", "fa": "جذابیت ارزشگذاری"},
        "short": {"en": "Valuation", "fa": "ارزشگذاری"},
        "hint": {
            "en": "Price paid relative to conservative, dated cash-flow or asset estimates.",
            "fa": "قیمت پرداختی در مقایسه با برآورد محافظهکارانه و تاریخدار جریان نقد یا داراییها.",
        },
        "question": {
            "en": "Which assumption, if wrong, destroys the margin of safety here?",
            "fa": "کدام فرض اگر نادرست باشد حاشیه امنیت را از بین میبرد؟",
        },
    },
    {
        "key": "earnings_quality",
        "name": {"en": "Earnings quality", "fa": "کیفیت سود"},
        "short": {"en": "Earnings", "fa": "کیفیت سود"},
        "hint": {
            "en": "How much reported profit is backed by cash, repeatable operations and clean accounting.",
            "fa": "چه بخشی از سود گزارششده با وجه نقد، عملیات تکرارپذیر و حسابداری شفاف پشتیبانی میشود.",
        },
        "question": {
            "en": "Are one-off gains, related-party deals or capitalised costs inflating the number?",
            "fa": "آیا درآمدهای غیرتکراری، معاملات با اشخاص وابسته یا هزینههای سرمایهای سود را بزرگ کردهاند؟",
        },
    },
    {
        "key": "growth",
        "name": {"en": "Growth capacity", "fa": "ظرفیت رشد"},
        "short": {"en": "Growth", "fa": "رشد"},
        "hint": {
            "en": "Room to expand volume, price or market share without destroying returns on capital.",
            "fa": "امکان افزایش حجم، قیمت یا سهم بازار بدون تخریب بازده سرمایه.",
        },
        "question": {
            "en": "Does growth require fresh capital and dilution? A capital increase alone creates no value.",
            "fa": "آیا رشد به سرمایه تازه و رقیقشدن مالکیت نیاز دارد؟ افزایش سرمایه بهتنهایی خلق ارزش نیست.",
        },
    },
    {
        "key": "market_momentum",
        "name": {"en": "Market momentum", "fa": "مومنتوم بازار"},
        "short": {"en": "Momentum", "fa": "مومنتوم"},
        "hint": {
            "en": "Price and volume behaviour. This is sentiment, not a fundamental fact.",
            "fa": "رفتار قیمت و حجم معاملات. این احساسات بازار است، نه یک واقعیت بنیادی.",
        },
        "question": {
            "en": "Could recent price strength be the reason you want to believe the other five factors?",
            "fa": "آیا رشد اخیر قیمت دلیل تمایل شما به باور پنج عامل دیگر شده است؟",
        },
    },
    {
        "key": "risk_control",
        "name": {"en": "Risk control", "fa": "کنترل ریسک"},
        "short": {"en": "Risk", "fa": "ریسک"},
        "hint": {
            "en": "Leverage, liquidity, concentration, governance and disclosure quality.",
            "fa": "اهرم مالی، نقدشوندگی، تمرکز، حاکمیت شرکتی و کیفیت افشا.",
        },
        "question": {
            "en": "What is the tail risk that would make this position unrecoverable?",
            "fa": "کدام ریسک دنبالهدار میتواند این موقعیت را جبرانناپذیر کند؟",
        },
    },
]

STATUS_META = {
    "deep_review": {
        "en": "Deeper review", "fa": "بررسی عمیقتر", "tone": "focus",
        "en_detail": "High composite score. A prompt to investigate, not a signal to act.",
        "fa_detail": "امتیاز ترکیبی بالا. دعوتی برای تحقیق بیشتر، نه سیگنالی برای اقدام.",
    },
    "reviewable": {
        "en": "Worth reviewing", "fa": "قابل بررسی", "tone": "positive",
        "en_detail": "Above the middle band. Check the weakest factors first.",
        "fa_detail": "بالاتر از میانه. ابتدا ضعیفترین عاملها را بررسی کنید.",
    },
    "more_evidence": {
        "en": "Needs more evidence", "fa": "نیازمند شواهد بیشتر", "tone": "caution",
        "en_detail": "Borderline result. Small input changes can move the band.",
        "fa_detail": "نتیجه مرزی. تغییر کوچک ورودیها میتواند رده را جابهجا کند.",
    },
    "low_priority": {
        "en": "Lower priority in this screen", "fa": "اولویت پایین در این غربال", "tone": "neutral",
        "en_detail": "Lowest band under the current weights. It is not a sell recommendation.",
        "fa_detail": "پایینترین رده با وزنهای فعلی. این توصیه فروش نیست.",
    },
    "incomplete": {
        "en": "Incomplete data", "fa": "اطلاعات ناقص", "tone": "muted",
        "en_detail": "No score is computed when any factor is missing. Absence of data is not a zero.",
        "fa_detail": "با نبودن حتی یک عامل، امتیازی محاسبه نمیشود. نبود داده بهمعنای صفر نیست.",
    },
}

LIMITATIONS = [
    {
        "en": "No live market or Codal data is fetched. Every score in this tool is entered or imported by you.",
        "fa": "هیچ داده زندهای از بازار یا کدال دریافت نمیشود. همه امتیازها را شما وارد یا بارگذاری میکنید.",
    },
    {
        "en": "Scores depend on the quality, source and date of the underlying research. Undated opinions age quickly.",
        "fa": "امتیازها به کیفیت، منبع و تاریخ پژوهش بستگی دارند. نظر بدون تاریخ بهسرعت کهنه میشود.",
    },
    {
        "en": "The composite is a weighted average of subjective inputs, not a probability, valuation or forecast.",
        "fa": "امتیاز ترکیبی میانگین وزنی ورودیهای ذهنی است، نه احتمال، ارزشگذاری یا پیشبینی.",
    },
    {
        "en": "A capital increase by itself does not create value; dilution, use of proceeds and profitability must be examined separately.",
        "fa": "افزایش سرمایه بهتنهایی خلق ارزش نیست؛ رقیقشدن، محل مصرف وجوه و سودآوری باید جداگانه بررسی شود.",
    },
    {
        "en": "The Monte Carlo engine uses assumptions you choose. Its outputs are not calibrated probabilities of gain or loss.",
        "fa": "موتور مونتکارلو از فرضهایی که شما انتخاب میکنید استفاده میکند؛ خروجی آن احتمال واقعی سود یا زیان نیست.",
    },
    {
        "en": "Nothing here is investment advice, a buy/sell signal, or a guarantee of return.",
        "fa": "هیچیک از موارد اینجا توصیه سرمایهگذاری، سیگنال خرید و فروش یا تضمین بازده نیست.",
    },
]

# Persian and Arabic-Indic digits are accepted in numeric cells.
_DIGIT_MAP = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789"
)
_SEPARATOR_MAP = str.maketrans({"٬": "", ",": "", "٫": ".", " ": ""})

COLUMN_ALIASES = {
    "ticker": ["ticker", "symbol", "code", "stock", "name", "نماد", "شرکت", "سهم"],
    "competition": ["competition", "competitive_strength", "competitive", "قدرت_رقابتی", "قدرت رقابتی", "رقابت"],
    "valuation": ["valuation", "valuation_appeal", "value", "ارزشگذاری", "جذابیت_ارزشگذاری"],
    "earnings_quality": ["earnings_quality", "earnings", "quality", "کیفیت_سود", "کیفیت سود"],
    "growth": ["growth", "growth_capacity", "رشد", "ظرفیت_رشد"],
    "market_momentum": ["market_momentum", "momentum", "مومنتوم", "مومنتوم_بازار"],
    "risk_control": ["risk_control", "risk", "کنترل_ریسک", "ریسک"],
    "note": ["note", "memo", "analyst_note", "یادداشت", "توضیح"],
}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def api_error(message: str, code: str = "bad_request", status: int = 400, **extra):
    payload = {"ok": False, "error": {"code": code, "message": message}}
    payload.update(extra)
    return jsonify(payload), status


def _as_number(value):
    """Return a finite float or None. Accepts localized numeric strings."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip().translate(_DIGIT_MAP).translate(_SEPARATOR_MAP)
        if text in ("", "-", "—", "nan", "NaN", "null", "None"):
            return None
        try:
            number = float(text)
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def coerce_score(value):
    """Return (score_or_None, warning_code_or_None)."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None, None
    number = _as_number(value)
    if number is None:
        return None, "invalid_score"
    if number < 0 or number > 100:
        return None, "out_of_range"
    return round(number, 2), None


def _clean_text(value, limit=48):
    if value is None:
        return ""
    text = re.sub(r"[\x00-\x1f\x7f]", " ", str(value)).strip()
    return text[:limit]


def sanitize_rows(raw_rows):
    """Validate untrusted row payloads. Never let a bad cell fabricate a score."""
    if not isinstance(raw_rows, list):
        raise ValueError("`rows` must be a list")
    if len(raw_rows) > MAX_ROWS:
        raise ValueError(f"At most {MAX_ROWS} rows are supported per universe")

    clean, warnings = [], []
    seen = {}
    for index, item in enumerate(raw_rows, start=1):
        if not isinstance(item, dict):
            warnings.append({"code": "row_skipped", "row": index})
            continue
        ticker = _clean_text(item.get("ticker"), 48)
        if not ticker:
            warnings.append({"code": "missing_ticker", "row": index})
            continue
        row = {
            "id": _clean_text(item.get("id"), 80) or f"row-{index}",
            "ticker": ticker,
            "note": _clean_text(item.get("note"), 600),
        }
        if ticker.casefold() in seen:
            warnings.append({"code": "duplicate_ticker", "row": index, "value": ticker})
        seen[ticker.casefold()] = True
        for factor in FACTOR_KEYS:
            score, problem = coerce_score(item.get(factor))
            row[factor] = score
            if problem:
                warnings.append({
                    "code": problem,
                    "row": index,
                    "value": ticker,
                    "factor": factor,
                })
        clean.append(row)
    return clean, warnings


def rows_to_frame(rows):
    frame = pd.DataFrame(rows)
    if frame.empty:
        frame = pd.DataFrame(columns=["__id", "ticker", "note"] + FACTOR_KEYS)
    for column in ["__id", "ticker", "note"] + FACTOR_KEYS:
        if column not in frame.columns:
            frame[column] = None
    frame["__id"] = [row["id"] for row in rows]
    return frame[["__id", "ticker", "note"] + FACTOR_KEYS]


def _scalar(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, float):
        return round(value, 4)
    return value


def _read_csv_rows(path: Path):
    frame = pd.read_csv(path, encoding="utf-8-sig")
    records = frame.replace({np.nan: None}).to_dict(orient="records")
    clean, warnings = sanitize_rows(records)
    return clean, warnings


def _dataset_payload():
    demo, _ = _read_csv_rows(DATA_DIR / "illustrative_demo.csv")
    blank, _ = _read_csv_rows(BASE_DIR / "iran_universe_blank.csv")
    for rows, prefix in ((demo, "demo"), (blank, "blank")):
        for index, row in enumerate(rows, start=1):
            row["id"] = f"{prefix}-{index}"
    return [
        {
            "id": "demo",
            "label": {"en": "Illustrative demo (synthetic)", "fa": "نمای آزمایشی (ساختگی)"},
            "description": {
                "en": "14 fictional DEMO rows with made-up scores, including two incomplete rows. Built to explore the interface — never real research.",
                "fa": "۱۴ ردیف خیالی DEMO با امتیازهای ساختگی و دو ردیف ناقص. فقط برای آشنایی با رابط است، نه پژوهش واقعی.",
            },
            "synthetic": True,
            "rows": demo,
        },
        {
            "id": "blank",
            "label": {"en": "Iran ticker list (empty scores)", "fa": "فهرست نمادهای ایران (بدون امتیاز)"},
            "description": {
                "en": "18 sample Iranian symbols from the shipped blank list. All scores are empty so you must enter your own dated research.",
                "fa": "۱۸ نماد نمونه ایرانی از فهرست خالی همراه بسته. همه امتیازها خالی است تا پژوهش تاریخدار خود را وارد کنید.",
            },
            "synthetic": False,
            "rows": blank,
        },
    ]


def _weights_from_payload(payload):
    """Return (effective_weights, applied_weights, was_normalized, zero_fallback).

    An all-zero weight vector cannot define a weighted average. Rather than
    failing the request (or silently inventing numbers), the model falls back to
    its published defaults and reports that fallback as a warning.
    """
    raw = payload.get("weights")
    if raw is None:
        return None, normalize_weights(), False, False
    if not isinstance(raw, dict):
        raise ValueError("`weights` must be an object")
    cleaned = {key: max(0.0, _as_number(raw.get(key)) or 0.0) for key in FACTOR_KEYS}
    total_before = sum(cleaned.values())
    zero_fallback = total_before <= 0
    effective = dict(WEIGHTS) if zero_fallback else cleaned
    normalized = normalize_weights(effective)
    was_normalized = (not zero_fallback) and abs(total_before - 1.0) > 1e-6
    return effective, normalized, was_normalized, zero_fallback


def score_payload(payload):
    rows, warnings = sanitize_rows(payload.get("rows", []))
    raw_weights, applied_weights, was_normalized, zero_fallback = _weights_from_payload(payload)
    frame = rows_to_frame(rows)

    ranked = score_universe(frame, weights=raw_weights)
    equal_weights = {key: 1 / len(FACTOR_KEYS) for key in FACTOR_KEYS}
    equal_ranked = score_universe(frame, weights=equal_weights)
    equal_ranks = {
        row["__id"]: position
        for position, row in enumerate(equal_ranked.to_dict("records"), start=1)
        if bool(row["score_complete"])
    }

    results = []
    for position, record in enumerate(ranked.to_dict("records"), start=1):
        complete = bool(record["score_complete"])
        composite = _scalar(record["composite_score"]) if complete else None
        results.append({
            "id": record["__id"],
            "ticker": record["ticker"],
            "note": record["note"] or "",
            "factors": {key: _scalar(record[key]) for key in FACTOR_KEYS},
            "contributions": {
                key: (round(record[key] * applied_weights[key], 2)
                      if record[key] is not None and not pd.isna(record[key]) else None)
                for key in FACTOR_KEYS
            },
            "score_complete": complete,
            "composite_score": composite,
            "status_key": record["screen_status_key"] if complete else "incomplete",
            "status_fa": record["screen_status"],
            "rank": position if complete else None,
            "equal_rank": equal_ranks.get(record["__id"]) if complete else None,
            "rank_delta": ((equal_ranks.get(record["__id"], position) - position)
                           if complete else None),
        })

    scores = [row["composite_score"] for row in results if row["composite_score"] is not None]
    distribution = []
    for low in range(0, 100, 10):
        high = low + 10
        distribution.append({
            "from": low,
            "to": high,
            "count": sum(1 for score in scores if low <= score < high or (high == 100 and score == 100)),
        })
    medians = {}
    coverage = {}
    for key in FACTOR_KEYS:
        values = [row["factors"][key] for row in results if row["factors"][key] is not None]
        coverage[key] = round(len(values) / len(results), 4) if results else 0.0
        medians[key] = round(float(np.median(values)), 2) if values else None

    stats = {
        "total": len(results),
        "complete": len(scores),
        "incomplete": len(results) - len(scores),
        "median": round(float(np.median(scores)), 2) if scores else None,
        "mean": round(float(np.mean(scores)), 2) if scores else None,
        "min": round(float(np.min(scores)), 2) if scores else None,
        "max": round(float(np.max(scores)), 2) if scores else None,
        "p25": round(float(np.quantile(scores, 0.25)), 2) if scores else None,
        "p75": round(float(np.quantile(scores, 0.75)), 2) if scores else None,
        "status_counts": {
            key: sum(1 for row in results if row["status_key"] == key)
            for key in STATUS_META
        },
        "distribution": distribution,
        "factor_medians": medians,
        "factor_coverage": coverage,
        "rank_movers": sum(
            1 for row in results if row["rank_delta"] is not None and abs(row["rank_delta"]) >= 2
        ),
    }
    if was_normalized:
        warnings.append({"code": "weights_normalized"})
    if zero_fallback:
        warnings.append({"code": "weights_zero_fallback"})
    if not results:
        warnings.append({"code": "empty_universe"})
    return {
        "ok": True,
        "rows": results,
        "stats": stats,
        "warnings": warnings,
        "weights_applied": dict(applied_weights),
        "weights_requested": (
            {key: round(max(0.0, _as_number((payload.get("weights") or {}).get(key)) or 0.0), 6)
             for key in FACTOR_KEYS}
            if isinstance(payload.get("weights"), dict) else dict(WEIGHTS)
        ),
        "weights_normalized": was_normalized,
        "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _parse_sim_number(payload, key, default, low, high):
    value = _as_number(payload.get(key, default))
    if value is None or not (low <= value <= high):
        raise ValueError(f"`{key}` must be between {low} and {high}")
    return value


def simulation_payload(payload):
    capital = _parse_sim_number(payload, "initial_capital", 100_000_000, 1, 1e12)
    annual_return = _parse_sim_number(payload, "annual_return", 0.15, -0.99, 2.0)
    volatility = _parse_sim_number(payload, "volatility", 0.30, 0.0, 3.0)
    years = _parse_sim_number(payload, "years", 1.0, 0.05, 30.0)
    simulations = int(_parse_sim_number(payload, "simulations", 10000, 100, 50000))
    seed = int(_parse_sim_number(payload, "seed", 42, 0, 999999))

    summary, terminal = monte_carlo_terminal_values(
        initial_capital=capital,
        annual_return_assumption=annual_return,
        annual_volatility=volatility,
        years=years,
        simulations=simulations,
        seed=seed,
        return_terminals=True,
    )

    # Extreme tails are clipped from the *chart* only; every statistic uses all
    # simulations. This is stated in the UI so the picture is never misleading.
    low_edge = float(np.quantile(terminal, 0.005))
    high_edge = float(np.quantile(terminal, 0.995))
    if high_edge <= low_edge:
        high_edge = low_edge + 1.0
    clipped = np.clip(terminal, low_edge, high_edge)
    counts, edges = np.histogram(clipped, bins=40, range=(low_edge, high_edge))
    histogram = [
        {"x0": float(edges[i]), "x1": float(edges[i + 1]), "count": int(counts[i])}
        for i in range(len(counts))
    ]
    tail_low = int(np.sum(terminal < low_edge))
    tail_high = int(np.sum(terminal > high_edge))

    # Assumption sensitivity: the same seed at half and double the volatility.
    sensitivity = []
    for label, multiplier in (("low", 0.5), ("base", 1.0), ("high", 1.5)):
        alt, _ = monte_carlo_terminal_values(
            initial_capital=capital,
            annual_return_assumption=annual_return,
            annual_volatility=min(volatility * multiplier, 3.0),
            years=years,
            simulations=simulations,
            seed=seed,
            return_terminals=True,
        )
        sensitivity.append({
            "key": label,
            "volatility": round(min(volatility * multiplier, 3.0), 4),
            "p05": round(alt["p05_terminal_value"], 2),
            "median": round(alt["median_terminal_value"], 2),
            "p95": round(alt["p95_terminal_value"], 2),
            "loss_chance": round(alt["fraction_loss_under_assumptions"], 4),
        })

    return {
        "ok": True,
        "summary": {key: (round(value, 6) if isinstance(value, float) else value)
                    for key, value in summary.items()},
        "histogram": histogram,
        "markers": {
            "p05": summary["p05_terminal_value"],
            "median": summary["median_terminal_value"],
            "p95": summary["p95_terminal_value"],
            "initial": capital,
        },
        "chart_bounds": {"low": low_edge, "high": high_edge,
                         "tail_low": tail_low, "tail_high": tail_high},
        "sensitivity": sensitivity,
        "computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def _canonical_columns(frame):
    lookup = {}
    for column in frame.columns:
        key = re.sub(r"[\s\-]+", "_", str(column).strip().lower()).strip("_")
        lookup.setdefault(key, column)
    mapping = {}
    for canonical, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            normalized = re.sub(r"[\s\-]+", "_", alias.strip().lower()).strip("_")
            if normalized in lookup:
                mapping[canonical] = lookup[normalized]
                break
    return mapping


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #

@app.after_request
def safety_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.get("/")
def index():
    return render_template("index.html", version=APP_VERSION)


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "version": APP_VERSION, "model": "AQx–Tirole Omega"})


@app.get("/api/meta")
def meta():
    return jsonify({
        "ok": True,
        "version": APP_VERSION,
        "model": "AQx–Tirole Omega",
        "factors": FACTOR_META,
        "weights": WEIGHTS,
        "bands": [{"min": threshold, "status": key} for threshold, key in SCREEN_BANDS],
        "statuses": STATUS_META,
        "limitations": LIMITATIONS,
        "max_rows": MAX_ROWS,
        "max_upload_bytes": MAX_UPLOAD_BYTES,
        "factor_keys": FACTOR_KEYS,
    })


@app.get("/api/datasets")
def datasets():
    return jsonify({"ok": True, "datasets": _dataset_payload()})


@app.post("/api/score")
def score_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return api_error("A JSON object is required", "invalid_json")
    try:
        return jsonify(score_payload(payload))
    except ValueError as exc:
        return api_error(str(exc), "validation_error")


@app.post("/api/simulate")
def simulate_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return api_error("A JSON object is required", "invalid_json")
    try:
        return jsonify(simulation_payload(payload))
    except ValueError as exc:
        return api_error(str(exc), "validation_error")


@app.post("/api/import")
def import_route():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return api_error("Choose a CSV file first", "no_file")
    if not upload.filename.lower().endswith((".csv", ".txt", ".tsv")):
        return api_error("Only CSV or delimited text files are supported", "file_type")
    data = upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return api_error("The file is larger than 2 MB", "file_too_large", 413)

    text = None
    for encoding in ("utf-8-sig", "cp1256", "latin-1"):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return api_error("Could not decode the file", "decode_error")

    try:
        try:
            frame = pd.read_csv(io.StringIO(text), sep=None, engine="python",
                                dtype=str, keep_default_na=False)
        except Exception:  # noqa: BLE001 - fall back to plain comma parsing
            frame = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False)
    except Exception as exc:  # noqa: BLE001
        return api_error("The CSV could not be parsed", "parse_error", 400, detail=str(exc))

    mapping = _canonical_columns(frame)
    if "ticker" not in mapping:
        return api_error(
            "A ticker/symbol column is required. Expected headers: ticker, "
            + ", ".join(FACTOR_KEYS),
            "missing_ticker_column",
            422,
        )
    warnings = []
    missing_factors = [key for key in FACTOR_KEYS if key not in mapping]
    if missing_factors:
        warnings.append({"code": "missing_columns", "value": ", ".join(missing_factors)})
    ignored = [str(column) for column in frame.columns if column not in mapping.values()]
    if ignored:
        warnings.append({"code": "ignored_columns", "value": ", ".join(ignored[:8])})
    if len(frame) > MAX_ROWS:
        warnings.append({"code": "rows_truncated", "value": str(MAX_ROWS)})
        frame = frame.head(MAX_ROWS)

    records = []
    for _, raw in frame.iterrows():
        record = {"ticker": raw.get(mapping["ticker"], "")}
        for key in FACTOR_KEYS:
            record[key] = raw.get(mapping[key], "") if key in mapping else ""
        if "note" in mapping:
            record["note"] = raw.get(mapping["note"], "")
        records.append(record)
    rows, row_warnings = sanitize_rows(records)
    warnings.extend(row_warnings)
    for index, row in enumerate(rows, start=1):
        row["id"] = f"import-{index}"

    return jsonify({
        "ok": True,
        "rows": rows,
        "warnings": warnings,
        "filename": _clean_text(upload.filename, 120),
        "detected_columns": list(mapping.keys()),
    })


@app.get("/api/template.csv")
def template_csv():
    header = ["ticker"] + FACTOR_KEYS + ["note"]
    example = ["EXAMPLE_ONLY", 70, 65, 75, 60, 55, 60, "Illustrative only — replace me"]
    blank = ["YOUR_TICKER"] + [""] * len(FACTOR_KEYS) + [""]
    output = io.StringIO()
    import csv
    writer = csv.writer(output)
    writer.writerow(header)
    writer.writerow(example)
    writer.writerow(blank)
    return Response(
        "\ufeff" + output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=aqx_universe_template.csv"},
    )


@app.post("/api/export")
def export_route():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return api_error("A JSON object is required", "invalid_json")
    try:
        scored = score_payload(payload)
    except ValueError as exc:
        return api_error(str(exc), "validation_error")
    as_of = _clean_text(payload.get("asOf"), 40)
    columns = (
        ["rank", "ticker", "composite_score", "screen_status", "screen_status_key"]
        + FACTOR_KEYS
        + ["score_complete", "as_of_date", "analyst_memo"]
        + ["weight_" + key for key in FACTOR_KEYS]
    )
    output = io.StringIO()
    import csv
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in scored["rows"]:
        writer.writerow([
            row["rank"] if row["rank"] is not None else "",
            row["ticker"],
            row["composite_score"] if row["composite_score"] is not None else "",
            row["status_fa"],
            row["status_key"],
            *[row["factors"][key] if row["factors"][key] is not None else "" for key in FACTOR_KEYS],
            "true" if row["score_complete"] else "false",
            as_of,
            row["note"],
            *[round(scored["weights_applied"][key], 6) for key in FACTOR_KEYS],
        ])
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return Response(
        "\ufeff" + output.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f"attachment; filename=aqx_ranked_{stamp}.csv"},
    )


@app.errorhandler(413)
def too_large(_exc):
    return api_error("The request is larger than 2 MB", "file_too_large", 413)


@app.errorhandler(404)
def not_found(_exc):
    if request.path.startswith("/api/"):
        return api_error("Endpoint not found", "not_found", 404)
    return render_template("index.html", version=APP_VERSION), 404


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
