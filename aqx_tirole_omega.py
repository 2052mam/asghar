# AQx–Tirole Omega v1.0
# Educational research prototype. Not investment advice.
# Input CSV: one row per ticker; scores are 0..100.
# Missing scores are left missing and the final score is not computed for incomplete rows.
#
# v1.1 (GUI edition): `score_universe` and `monte_carlo_terminal_values` accept
# optional parameters so the Flask interface can reuse exactly the same maths as
# the CLI. Default behaviour and CLI output are unchanged.

from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

WEIGHTS = {
    "competition": 0.25,
    "valuation": 0.25,
    "earnings_quality": 0.15,
    "growth": 0.15,
    "market_momentum": 0.10,
    "risk_control": 0.10,
}
REQUIRED = ["ticker"] + list(WEIGHTS)

# Thresholds are published in the interface so that a score is never a black box.
SCREEN_BANDS = [
    (80, "deep_review"),
    (70, "reviewable"),
    (60, "more_evidence"),
]
STATUS_LABELS_FA = {
    "deep_review": "بررسی عمیق‌تر",
    "reviewable": "قابل بررسی",
    "more_evidence": "نیازمند شواهد بیشتر",
    "low_priority": "اولویت پایین در این غربال",
    "incomplete": "اطلاعات ناقص",
}


def normalize_weights(weights: dict | None = None) -> dict[str, float]:
    """Return a validated, non-negative weight mapping that sums to 1.

    Unknown factors, negative weights and all-zero weights are rejected. Any
    positive set of weights is scaled proportionally: the interface reports the
    applied (normalised) weights back to the user instead of silently changing
    their intent.
    """
    raw = WEIGHTS if weights is None else weights
    unknown = [key for key in raw if key not in WEIGHTS]
    if unknown:
        raise ValueError("Unknown factor(s): " + ", ".join(map(str, unknown)))
    missing = [key for key in WEIGHTS if key not in raw]
    if missing:
        raise ValueError("Missing factor weight(s): " + ", ".join(missing))
    try:
        values = {key: float(raw[key]) for key in WEIGHTS}
    except (TypeError, ValueError) as exc:
        raise ValueError("Weights must be numeric") from exc
    if any(not np.isfinite(value) or value < 0 for value in values.values()):
        raise ValueError("Weights must be finite and non-negative")
    total = sum(values.values())
    if total <= 0:
        raise ValueError("At least one weight must be greater than zero")
    if abs(total - 1.0) > 1e-9:
        values = {key: value / total for key, value in values.items()}
    return values


def score_universe(df: pd.DataFrame, weights: dict | None = None) -> pd.DataFrame:
    """Score a universe of 0..100 factor scores.

    `weights` may override the default factor weights (it is normalised first).
    Extra columns are copied through untouched, which lets a caller correlate
    sorted results with its own row identifiers or analyst memos.
    """
    w = normalize_weights(weights)
    missing_cols = [c for c in REQUIRED if c not in df.columns]
    if missing_cols:
        raise ValueError("Missing required columns: " + ", ".join(missing_cols))
    out = df.copy()
    for c in WEIGHTS:
        out[c] = pd.to_numeric(out[c], errors="coerce")
        invalid = out[c].notna() & ~out[c].between(0, 100)
        if invalid.any():
            raise ValueError(f"{c}: scores must be between 0 and 100")
    complete = out[list(WEIGHTS)].notna().all(axis=1)
    out["score_complete"] = complete
    out["composite_score"] = np.nan
    out.loc[complete, "composite_score"] = sum(
        out.loc[complete, factor] * weight for factor, weight in w.items()
    ).round(2)
    out["screen_status"] = np.where(
        ~complete, STATUS_LABELS_FA["incomplete"],
        np.select(
            [out["composite_score"] >= 80, out["composite_score"] >= 70,
             out["composite_score"] >= 60],
            [STATUS_LABELS_FA[key] for _, key in SCREEN_BANDS],
            default=STATUS_LABELS_FA["low_priority"]
        )
    )
    out["screen_status_key"] = np.where(
        ~complete, "incomplete",
        np.select(
            [out["composite_score"] >= 80, out["composite_score"] >= 70,
             out["composite_score"] >= 60],
            [key for _, key in SCREEN_BANDS],
            default="low_priority"
        )
    )
    return out.sort_values("composite_score", ascending=False, na_position="last")


def monte_carlo_terminal_values(initial_capital, annual_return_assumption,
                                annual_volatility, years=1.0,
                                simulations=10000, seed=42,
                                return_terminals=False):
    """Illustrative scenario engine. Inputs are assumptions, not calibrated forecasts.

    With `return_terminals=True` the function returns `(summary, terminal_values)`;
    the interface uses the raw values to draw an honest distribution instead of
    showing only a single attractive average.
    """
    if initial_capital <= 0 or years <= 0 or simulations < 100:
        raise ValueError("Capital/years must be positive and simulations >= 100.")
    if annual_volatility < 0:
        raise ValueError("Volatility cannot be negative.")
    if annual_return_assumption <= -1:
        raise ValueError("Annual return assumption must be greater than -100%.")
    mu = np.log1p(annual_return_assumption) - 0.5 * annual_volatility**2
    rng = np.random.default_rng(seed)
    z = rng.standard_normal(simulations)
    terminal = initial_capital * np.exp(
        mu * years + annual_volatility * np.sqrt(years) * z
    )
    returns = terminal / initial_capital - 1
    cutoff = np.quantile(returns, 0.05)
    tail = returns[returns <= cutoff]
    summary = {
        "simulations": simulations,
        "years": years,
        "assumed_annual_return": annual_return_assumption,
        "assumed_annual_volatility": annual_volatility,
        "median_terminal_value": float(np.median(terminal)),
        "p05_terminal_value": float(np.quantile(terminal, 0.05)),
        "p95_terminal_value": float(np.quantile(terminal, 0.95)),
        "fraction_loss_under_assumptions": float(np.mean(returns < 0)),
        "VaR95_loss_fraction": float(max(0.0, -cutoff)),
        "CVaR95_loss_fraction": float(max(0.0, -np.mean(tail))),
    }
    if return_terminals:
        return summary, terminal
    return summary


def main():
    parser = argparse.ArgumentParser(description="AQx–Tirole Omega screening prototype")
    parser.add_argument("--input", default="universe_input.csv")
    parser.add_argument("--output", default="aqx_ranked_output.csv")
    args = parser.parse_args()
    ranked = score_universe(pd.read_csv(args.input))
    ranked.to_csv(args.output, index=False, encoding="utf-8-sig")
    print(ranked[["ticker", "composite_score", "screen_status"]].to_string(index=False))
    print(f"Saved: {args.output}")
    print("Scores depend on the quality and date of input data.")


if __name__ == "__main__":
    main()
