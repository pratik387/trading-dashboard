"""
Trading Dashboard UI - Streamlit
================================

Run:
    streamlit run app.py --server.port 8501 --server.address 0.0.0.0
"""

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime

from oci_reader import OCIDataReader

st.set_page_config(
    page_title="Trading Dashboard",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
    .positive { color: #00c853; }
    .negative { color: #ff1744; }
</style>
""", unsafe_allow_html=True)


@st.cache_resource
def get_reader():
    return OCIDataReader()


@st.cache_data(ttl=300)
def load_runs(_reader, limit: int = 50):
    return _reader.list_runs(limit=limit)


@st.cache_data(ttl=60)
def load_sessions(_reader, run_id: str):
    return _reader.list_sessions(run_id)


@st.cache_data(ttl=30)
def load_run_summary(_reader, run_id: str, days: int):
    return _reader.get_run_summary(run_id, last_n_days=days)


@st.cache_data(ttl=10)
def load_daily_summary(_reader, run_id: str, session_date: str):
    return _reader.get_daily_summary(run_id, session_date)


@st.cache_data(ttl=60)
def load_trade_details(_reader, run_id: str, session_date: str, trade_id: str):
    return _reader.get_trade_details(run_id, session_date, trade_id)


def fmt_inr(value: float) -> str:
    if value >= 0:
        return f"₹{value:,.2f}"
    return f"-₹{abs(value):,.2f}"


def fmt_pct(value: float) -> str:
    return f"{value:.1f}%"


def render_live_tab(reader, run_id: str, sessions: list):
    st.header("🔴 Live Monitor")

    if not sessions:
        st.warning("No sessions found")
        return

    col1, col2 = st.columns([3, 1])
    with col1:
        st.subheader(f"Latest: {sessions[0]}")
    with col2:
        if st.button("🔄 Refresh"):
            st.cache_data.clear()
            st.rerun()

    summary = load_daily_summary(reader, run_id, sessions[0])

    col1, col2, col3, col4, col5 = st.columns(5)
    col1.metric("PnL", fmt_inr(summary['total_pnl']))
    col2.metric("Trades", summary['trades'])
    col3.metric("Win Rate", fmt_pct(summary['win_rate']))
    col4.metric("W/L", f"{summary['winners']}/{summary['losers']}")
    col5.metric("Updated", datetime.now().strftime("%H:%M:%S"))

    st.divider()
    st.subheader("Recent Exits")

    analytics = reader.get_analytics(run_id, sessions[0])
    if analytics:
        recent = sorted(analytics, key=lambda x: x.get('timestamp', ''), reverse=True)[:15]
        for exit in recent:
            pnl = exit.get('pnl', 0)
            icon = "🟢" if pnl > 0 else "🔴"
            symbol = exit.get('symbol', '?')
            reason = exit.get('reason', '?')
            time = exit.get('timestamp', '')[-8:]
            final = "✅" if exit.get('is_final_exit') else ""
            st.write(f"{icon} **{time}** | {symbol} | {reason} | {fmt_inr(pnl)} {final}")
    else:
        st.info("No exits yet")


def render_overview_tab(summary: dict):
    st.header("📊 Overview")

    col1, col2, col3, col4, col5 = st.columns(5)
    col1.metric("Total PnL", fmt_inr(summary['total_pnl']))
    col2.metric("Trades", summary['total_trades'])
    col3.metric("Win Rate", fmt_pct(summary['win_rate']))
    col4.metric("Avg PnL", fmt_inr(summary['avg_pnl_per_trade']))
    col5.metric("Sessions", summary['sessions_analyzed'])

    st.divider()

    if summary.get('daily_summaries'):
        df = pd.DataFrame(summary['daily_summaries'])
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'], errors='coerce')
            df = df.dropna(subset=['date']).sort_values('date')
            df['cumulative_pnl'] = df['total_pnl'].cumsum()

            st.subheader("📈 Equity Curve")
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=df['date'], y=df['cumulative_pnl'],
                mode='lines+markers', fill='tozeroy',
                line=dict(color='#1f77b4', width=2)
            ))
            fig.update_layout(template='plotly_white', hovermode='x unified')
            st.plotly_chart(fig, use_container_width=True)

            st.subheader("📊 Daily PnL")
            df['color'] = df['total_pnl'].apply(lambda x: '#00c853' if x >= 0 else '#ff1744')
            fig = go.Figure()
            fig.add_trace(go.Bar(x=df['date'], y=df['total_pnl'], marker_color=df['color']))
            fig.update_layout(template='plotly_white')
            st.plotly_chart(fig, use_container_width=True)


def render_setup_tab(summary: dict):
    st.header("🎯 Setup Analysis")

    setup_data = summary.get('by_setup', {})
    if not setup_data:
        st.warning("No setup data")
        return

    rows = []
    for setup, data in setup_data.items():
        win_rate = data['wins'] / data['count'] * 100 if data['count'] else 0
        avg_pnl = data['pnl'] / data['count'] if data['count'] else 0
        rows.append({'Setup': setup, 'Trades': data['count'], 'PnL': data['pnl'],
                    'Win Rate': win_rate, 'Avg PnL': avg_pnl})

    df = pd.DataFrame(rows).sort_values('PnL', ascending=False)

    col1, col2 = st.columns(2)
    with col1:
        fig = px.bar(df, x='Setup', y='PnL', color='PnL',
                    color_continuous_scale=['red', 'yellow', 'green'])
        fig.update_layout(template='plotly_white', xaxis_tickangle=-45)
        st.plotly_chart(fig, use_container_width=True)
    with col2:
        fig = px.pie(df, values='Trades', names='Setup')
        st.plotly_chart(fig, use_container_width=True)

    display_df = df.copy()
    display_df['PnL'] = display_df['PnL'].apply(fmt_inr)
    display_df['Win Rate'] = display_df['Win Rate'].apply(lambda x: f"{x:.1f}%")
    display_df['Avg PnL'] = display_df['Avg PnL'].apply(fmt_inr)
    st.dataframe(display_df, use_container_width=True, hide_index=True)


def render_regime_tab(summary: dict):
    st.header("🌊 Regime Analysis")

    regime_data = summary.get('by_regime', {})
    if not regime_data:
        st.warning("No regime data")
        return

    rows = []
    for regime, data in regime_data.items():
        avg_pnl = data['pnl'] / data['count'] if data['count'] else 0
        rows.append({'Regime': regime, 'Trades': data['count'], 'PnL': data['pnl'], 'Avg PnL': avg_pnl})

    df = pd.DataFrame(rows).sort_values('PnL', ascending=False)

    colors = {'squeeze': '#FFA500', 'trend_up': '#00C853', 'trend_down': '#FF1744', 'chop': '#9E9E9E'}

    col1, col2 = st.columns(2)
    with col1:
        bar_colors = [colors.get(r, '#1f77b4') for r in df['Regime']]
        fig = go.Figure()
        fig.add_trace(go.Bar(x=df['Regime'], y=df['PnL'], marker_color=bar_colors))
        fig.update_layout(template='plotly_white')
        st.plotly_chart(fig, use_container_width=True)
    with col2:
        fig = px.pie(df, values='Trades', names='Regime', color='Regime', color_discrete_map=colors)
        st.plotly_chart(fig, use_container_width=True)

    display_df = df.copy()
    display_df['PnL'] = display_df['PnL'].apply(fmt_inr)
    display_df['Avg PnL'] = display_df['Avg PnL'].apply(fmt_inr)
    st.dataframe(display_df, use_container_width=True, hide_index=True)


def render_sessions_tab(reader, run_id: str, sessions: list):
    st.header("📅 Session Details")

    if not sessions:
        st.warning("No sessions")
        return

    selected = st.selectbox("Select Session", sessions)
    summary = load_daily_summary(reader, run_id, selected)

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("PnL", fmt_inr(summary['total_pnl']))
    col2.metric("Trades", summary['trades'])
    col3.metric("Win Rate", fmt_pct(summary['win_rate']))
    col4.metric("W/L", f"{summary['winners']}/{summary['losers']}")

    st.divider()

    analytics = reader.get_analytics(run_id, selected)
    trades = [a for a in analytics if a.get('is_final_exit')]

    if trades:
        st.subheader("Trades")
        df = pd.DataFrame(trades)
        cols = ['trade_id', 'symbol', 'setup_type', 'regime', 'total_trade_pnl', 'reason']
        available = [c for c in cols if c in df.columns]
        display_df = df[available].copy()
        if 'total_trade_pnl' in display_df.columns:
            display_df['total_trade_pnl'] = display_df['total_trade_pnl'].apply(fmt_inr)
        st.dataframe(display_df, use_container_width=True, hide_index=True)


def main():
    st.title("📈 Trading Dashboard")
    st.caption("Reading from OCI Object Storage")

    try:
        reader = get_reader()
    except Exception as e:
        st.error(f"Failed to connect to OCI: {e}")
        return

    with st.sidebar:
        st.header("Config")

        with st.spinner("Loading runs..."):
            runs = load_runs(reader)

        if not runs:
            st.warning("No runs in bucket")
            return

        run_opts = [f"{r['run_id']}" for r in runs]
        selected_idx = st.selectbox("Run", range(len(run_opts)), format_func=lambda i: run_opts[i])
        selected_run = runs[selected_idx]['run_id']

        sessions = load_sessions(reader, selected_run)
        st.success(f"{len(sessions)} sessions")

        days = st.slider("Days", 7, min(180, len(sessions) if sessions else 30), 30)

        st.divider()
        st.caption(f"Run: {selected_run}")

        if st.button("🔄 Refresh All"):
            st.cache_data.clear()
            st.rerun()

    with st.spinner("Loading..."):
        summary = load_run_summary(reader, selected_run, days)

    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "🔴 Live", "📊 Overview", "🎯 Setups", "🌊 Regimes", "📅 Sessions"
    ])

    with tab1:
        render_live_tab(reader, selected_run, sessions)
    with tab2:
        render_overview_tab(summary)
    with tab3:
        render_setup_tab(summary)
    with tab4:
        render_regime_tab(summary)
    with tab5:
        render_sessions_tab(reader, selected_run, sessions)


if __name__ == "__main__":
    main()
