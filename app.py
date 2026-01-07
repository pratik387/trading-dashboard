"""
Trading Dashboard - Entry Point
===============================

Multipage Streamlit app for trading analysis.

Pages:
    1. Live Trading - Real-time monitoring during market hours
    2. Historical - Analysis of past trading sessions from OCI

Run:
    streamlit run app.py --server.port 8501 --server.address 0.0.0.0
"""

import streamlit as st

st.set_page_config(
    page_title="Trading Dashboard",
    page_icon="📊",
    layout="wide"
)

st.title("📊 Trading Dashboard")

st.markdown("""
Welcome to the Trading Dashboard. Select a page from the sidebar:

### Pages

- **🔴 Live Trading** - Monitor active trading sessions in real-time
  - View open positions with unrealized PnL
  - Track realized PnL from closed trades
  - Auto-refresh support during market hours

- **📈 Historical** - Analyze past trading performance
  - Overview of all trading days
  - Setup performance analysis
  - Daily breakdown and trade details
  - Compare different config strategies

### Config Types

- **fixed** - Fixed SL/Target levels
- **relative** - ATR-based SL/Target
- **1year** - 1-year lookback for levels
""")

st.divider()
st.caption("Select a page from the sidebar to begin.")
