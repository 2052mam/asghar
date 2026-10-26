# AQx–Tirole Omega v1.0
# Educational research prototype. Not investment advice.
# Input CSV: one row per ticker; scores are 0..100.
# Missing scores are left missing and the final score is not computed for incomplete rows.

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

def score_universe(df: pd.DataFrame) -> pd.DataFrame:
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
        out.loc[complete, factor] * weight for factor, weight in WEIGHTS.items()
    ).round(2)
    out["screen_status"] = np.where(
        ~complete, "اطلاعات ناقص",
        np.select(
            [out["composite_score"] >= 80, out["composite_score"] >= 70,
             out["composite_score"] >= 60],
            ["بررسی عمیق‌تر", "قابل بررسی", "نیازمند شواهد بیشتر"],
            default="اولویت پایین در این غربال"
        )
    )
    return out.sort_values("composite_score", ascending=False, na_position="last")

def monte_carlo_terminal_values(initial_capital, annual_return_assumption,
                                annual_volatility, years=1.0,
                                simulations=10000, seed=42):
    """Illustrative scenario engine. Inputs are assumptions, not calibrated forecasts."""
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
    return {
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
