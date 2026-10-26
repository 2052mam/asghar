"""End-to-end checks for the Flask layer and the shared analytical core."""

import csv
import io
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import app  # noqa: E402
from aqx_tirole_omega import monte_carlo_terminal_values, score_universe  # noqa: E402
import pandas as pd  # noqa: E402


@pytest.fixture()
def client():
    app.config.update(TESTING=True)
    with app.test_client() as test_client:
        yield test_client


def full_row(ticker, value=70, **overrides):
    row = {
        "id": ticker,
        "ticker": ticker,
        "competition": value,
        "valuation": value,
        "earnings_quality": value,
        "growth": value,
        "market_momentum": value,
        "risk_control": value,
    }
    row.update(overrides)
    return row


# ── Static shell & metadata ────────────────────────────────────────────────

def test_index_and_static_assets(client):
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "AQx–Tirole Omega" in html
    assert '<html lang="fa" dir="rtl"' in html, "Persian/RTL is the default document language"
    assert "/static/css/styles.css" in html
    assert 'type="module" src="/static/js/app.js"' in html
    assert 'lang-opt' in html and 'data-lang="en"' in html
    for asset in ("/static/css/styles.css", "/static/js/app.js",
                  "/static/js/i18n.js", "/static/js/charts.js", "/static/favicon.svg",
                  "/static/img/hero-aurora.jpg", "/static/img/girih.svg",
                  "/static/fonts/vazirmatn-arabic-wght-normal.woff2",
                  "/static/fonts/plus-jakarta-sans-latin-wght-normal.woff2"):
        assert client.get(asset).status_code == 200, asset


def test_health_and_meta(client):
    assert client.get("/api/health").json["version"] == "1.2.0"
    meta = client.get("/api/meta").json
    assert meta["ok"] is True
    assert len(meta["factors"]) == 6
    assert sum(meta["weights"].values()) == pytest.approx(1.0)
    assert set(meta["statuses"]) >= {"deep_review", "incomplete"}
    assert len(meta["limitations"]) >= 5
    assert all({"en", "fa"} <= set(factor["name"]) for factor in meta["factors"])


def test_datasets(client):
    payload = client.get("/api/datasets").json
    by_id = {item["id"]: item for item in payload["datasets"]}
    assert by_id["demo"]["synthetic"] is True
    assert len(by_id["demo"]["rows"]) == 14
    assert len(by_id["blank"]["rows"]) == 18
    assert all(row["competition"] is None for row in by_id["blank"]["rows"])


# ── Scoring ────────────────────────────────────────────────────────────────

def test_score_uniform_rows(client):
    response = client.post("/api/score", json={"rows": [full_row("A"), full_row("B")]})
    assert response.status_code == 200
    data = response.json
    assert [row["composite_score"] for row in data["rows"]] == [70.0, 70.0]
    assert all(row["status_key"] == "reviewable" for row in data["rows"])
    assert data["stats"]["complete"] == 2
    assert data["stats"]["median"] == 70.0
    assert data["stats"]["distribution"][7]["count"] == 2
    assert sum(data["weights_applied"].values()) == pytest.approx(1.0)
    assert data["rows"][0]["contributions"]["competition"] == 17.5


def test_incomplete_rows_are_never_imputed(client):
    row = full_row("C")
    row["risk_control"] = None
    data = client.post("/api/score", json={"rows": [row, full_row("A", 90)]}).json
    incomplete = next(item for item in data["rows"] if item["ticker"] == "C")
    assert incomplete["composite_score"] is None
    assert incomplete["score_complete"] is False
    assert incomplete["status_key"] == "incomplete"
    assert incomplete["rank"] is None
    assert data["stats"]["incomplete"] == 1
    assert data["stats"]["factor_coverage"]["risk_control"] == pytest.approx(0.5)


def test_invalid_cells_become_missing_with_warnings(client):
    rows = [full_row("A", competition=150), full_row("B", valuation="not-a-number"),
            full_row("C", growth="۹۲")]
    data = client.post("/api/score", json={"rows": rows}).json
    codes = {w["code"] for w in data["warnings"]}
    assert {"out_of_range", "invalid_score"} <= codes
    assert next(r for r in data["rows"] if r["ticker"] == "A")["score_complete"] is False
    assert next(r for r in data["rows"] if r["ticker"] == "C")["factors"]["growth"] == 92
    assert data["stats"]["complete"] == 1


def test_duplicate_tickers_are_flagged(client):
    data = client.post("/api/score", json={"rows": [full_row("A"), full_row("A") ]}).json
    assert any(w["code"] == "duplicate_ticker" for w in data["warnings"])


def test_custom_weights_are_normalised_and_reported(client):
    weights = {key: 1 for key in ["competition", "valuation", "earnings_quality",
                                  "growth", "market_momentum", "risk_control"]}
    data = client.post("/api/score", json={"rows": [full_row("A", 80)], "weights": weights}).json
    assert data["weights_normalized"] is True
    assert sum(data["weights_applied"].values()) == pytest.approx(1.0)
    assert any(w["code"] == "weights_normalized" for w in data["warnings"])
    assert data["stats"]["rank_movers"] == 0


def test_bad_weights_and_bad_payloads(client):
    weights = {key: 0 for key in ["competition", "valuation", "earnings_quality",
                                  "growth", "market_momentum", "risk_control"]}
    zero_weights = client.post("/api/score", json={"rows": [full_row("A")], "weights": weights})
    assert zero_weights.status_code == 200
    assert any(w["code"] == "weights_zero_fallback" for w in zero_weights.json["warnings"])
    assert zero_weights.json["weights_applied"] == pytest.approx(client.get("/api/meta").json["weights"])
    assert zero_weights.json["weights_requested"]["competition"] == 0
    assert client.post("/api/score", json={"rows": [full_row("A")], "weights": "invalid"}).status_code == 400
    assert client.post("/api/score", json={"rows": "oops"}).status_code == 400
    assert client.post("/api/score", json={"rows": [full_row(f"T{i}") for i in range(300)]}).status_code == 400


def test_equal_weight_sensitivity(client):
    rows = [
        full_row("MOMENTUM", 41, market_momentum=100, risk_control=100),
        full_row("STEADY", 75),
        full_row("VALUE", 40, competition=100, valuation=100),
        full_row("MID_HIGH", 62),
        full_row("MID_LOW", 57),
    ]
    data = client.post("/api/score", json={"rows": rows}).json
    ranked = {row["ticker"]: row for row in data["rows"]}
    assert ranked["STEADY"]["rank"] == 1
    assert all("equal_rank" in row and "rank_delta" in row for row in data["rows"])
    assert ranked["MOMENTUM"]["rank"] == 5
    assert ranked["MOMENTUM"]["rank_delta"] == -2
    assert data["stats"]["rank_movers"] >= 2


# ── Simulation ─────────────────────────────────────────────────────────────

def test_simulation_is_deterministic_and_transparent(client):
    payload = {"initial_capital": 1_000_000, "annual_return": 0.12,
               "volatility": 0.25, "years": 1, "simulations": 2000, "seed": 7}
    first = client.post("/api/simulate", json=payload).json
    second = client.post("/api/simulate", json=payload).json
    assert first["summary"]["median_terminal_value"] == second["summary"]["median_terminal_value"]
    assert len(first["histogram"]) == 40
    assert sum(bin_["count"] for bin_ in first["histogram"]) <= payload["simulations"]
    assert first["markers"]["p05"] <= first["markers"]["median"] <= first["markers"]["p95"]
    assert [row["key"] for row in first["sensitivity"]] == ["low", "base", "high"]
    assert first["sensitivity"][0]["p05"] >= first["sensitivity"][2]["p05"]
    assert first["chart_bounds"]["tail_low"] >= 0


def test_simulation_rejects_impossible_inputs(client):
    bad = {"initial_capital": -1}
    assert client.post("/api/simulate", json=bad).status_code == 400
    assert client.post("/api/simulate", json={"simulations": 10}).status_code == 400
    assert client.post("/api/simulate", json={"volatility": -0.2}).status_code == 400


# ── Import / export / template ─────────────────────────────────────────────

def test_import_csv_with_bom_and_persian_headers(client):
    content = "\ufeffنماد,رقابت,ارزشگذاری,کیفیت سود,رشد,مومنتوم,کنترل ریسک\n"
    content += "فولاد,80,70,65,55,60,75\n"
    content += "فملی,90,,72,61,58,80\n"
    response = client.post("/api/import", data={
        "file": (io.BytesIO(content.encode("utf-8")), "universe.csv"),
    }, content_type="multipart/form-data")
    assert response.status_code == 200
    data = response.json
    assert len(data["rows"]) == 2
    assert data["rows"][0]["ticker"] == "فولاد"
    assert data["rows"][0]["competition"] == 80
    assert data["rows"][1]["valuation"] is None
    assert "ticker" in data["detected_columns"]


def test_import_requires_ticker_column(client):
    response = client.post("/api/import", data={
        "file": (io.BytesIO(b"foo,bar\n1,2\n"), "bad.csv"),
    }, content_type="multipart/form-data")
    assert response.status_code == 422
    assert response.json["error"]["code"] == "missing_ticker_column"


def test_import_rejects_wrong_file_type(client):
    response = client.post("/api/import", data={
        "file": (io.BytesIO(b"PK\x03\x04"), "data.xlsx"),
    }, content_type="multipart/form-data")
    assert response.status_code == 400


def test_template_and_export(client):
    template = client.get("/api/template.csv")
    assert template.status_code == 200
    assert template.data.startswith(b"\xef\xbb\xbf")
    assert b"ticker,competition" in template.data

    response = client.post("/api/export", json={
        "rows": [full_row("TOP", 90), full_row("LOW", 40)],
        "asOf": "2026-10-26",
    })
    assert response.status_code == 200
    assert response.data.startswith(b"\xef\xbb\xbf")
    reader = list(csv.DictReader(io.StringIO(response.data.decode("utf-8-sig"))))
    assert reader[0]["ticker"] == "TOP"
    assert float(reader[0]["composite_score"]) == 90.0
    assert reader[0]["as_of_date"] == "2026-10-26"
    assert "weight_competition" in reader[0]
    assert float(reader[0]["weight_competition"]) == pytest.approx(0.25)


def test_api_404_is_json(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json["ok"] is False


# ── The original CLI is unchanged ──────────────────────────────────────────

def test_core_functions_still_work():
    frame = pd.DataFrame([full_row("A", 70)])
    assert float(score_universe(frame).iloc[0]["composite_score"]) == 70.0
    simple = pd.DataFrame([{
        "ticker": "X", "competition": 70, "valuation": 65,
        "earnings_quality": 75, "growth": 60, "market_momentum": 55,
        "risk_control": 60,
    }])
    assert float(score_universe(simple).iloc[0]["composite_score"]) == 65.5
    summary = monte_carlo_terminal_values(1000, 0.1, 0.2, simulations=500, seed=1)
    assert 0 <= summary["fraction_loss_under_assumptions"] <= 1


def test_cli_entrypoint(tmp_path):
    output = tmp_path / "ranked.csv"
    completed = subprocess.run(
        [sys.executable, str(ROOT / "aqx_tirole_omega.py"),
         "--input", str(ROOT / "universe_input_template.csv"),
         "--output", str(output)],
        capture_output=True, text=True, cwd=ROOT, check=True,
    )
    assert "EXAMPLE_ONLY" in completed.stdout
    assert output.exists()
    assert "65.5" in output.read_text(encoding="utf-8-sig")
