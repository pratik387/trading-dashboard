"""
Trading Dashboard - Entry Point
===============================

Uses st.navigation to control sidebar pages (hides main entry point).

Run:
    streamlit run app.py --server.port 8501 --server.address 0.0.0.0
"""

import streamlit as st

st.set_page_config(
    page_title="Trading Dashboard",
    page_icon="📊",
    layout="wide"
)

# Define pages - only these appear in sidebar
pages = [
    st.Page("pages/1_Live_Trading.py", title="Live Trading", icon="🔴", default=True),
    st.Page("pages/2_Historical.py", title="Historical", icon="📈"),
]

# Navigation - renders sidebar and runs selected page
nav = st.navigation(pages)
nav.run()
