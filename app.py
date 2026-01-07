"""
Trading Dashboard - Entry Point
===============================

Redirects to Live Trading page on load.

Run:
    streamlit run app.py --server.port 8501 --server.address 0.0.0.0
"""

import streamlit as st

st.set_page_config(
    page_title="Trading Dashboard",
    page_icon="📊",
    layout="wide"
)

# Auto-redirect to Live Trading
st.switch_page("pages/1_Live_Trading.py")
