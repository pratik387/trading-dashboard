"""
Trading Dashboard UI - Streamlit
================================

Shows combined dashboard of all runs within a config type (fixed, relative, 1year).
Each run represents one trading day.

Bucket structure:
    paper-trading-logs/
    ├── fixed/
    │   ├── paper_20260101_084724/   (Day 1)
    │   ├── paper_20260102_084500/   (Day 2)
    │   └── ...
    ├── relative/
    └── 1year/

Run:
    streamlit run app.py --server.port 8501 --server.address 0.0.0.0
"""

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
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
    /* Prevent metric value truncation */
    [data-testid="stMetricValue"] {
        font-size: 1.5rem;
        overflow: visible !important;
        white-space: nowrap !important;
        text-overflow: clip !important;
    }
    [data-testid="stMetricLabel"] {
        font-size: 0.9rem;
    }
    /* Fix date picker calendar - ensure header with month/year is visible */
    [data-baseweb="popover"] {
        overflow: visible !important;
    }
    [data-baseweb="calendar"] {
        padding-top: 10px !important;
    }
</style>
""", unsafe_allow_html=True)


@st.cache_resource
def get_reader():
    return OCIDataReader()


@st.cache_data(ttl=300)
def load_config_types(_reader):
    return _reader.list_config_types()


@st.cache_data(ttl=300)
def load_runs(_reader, config_type: str, limit: int = 100):
    return _reader.list_runs(config_type=config_type, limit=limit)


@st.cache_data(ttl=60)
def load_run_summary(_reader, config_type: str, run_id: str):
    return _reader.get_run_summary(config_type, run_id)


@st.cache_data(ttl=60)
def load_analytics(_reader, config_type: str, run_id: str):
    return _reader.get_analytics(config_type, run_id)


@st.cache_data(ttl=120)
def load_all_summaries(_reader, config_type: str, runs: list):
    """Load summaries for all runs in a config type"""
    summaries = []
    for run in runs:
        run_id = run['run_id']
        summary = _reader.get_run_summary(config_type, run_id)
        summary['date'] = run.get('timestamp', 'Unknown')
        summaries.append(summary)
    return summaries


def fmt_inr(value: float) -> str:
    if value >= 0:
        return f"₹{value:,.2f}"
    return f"-₹{abs(value):,.2f}"


def fmt_pct(value: float) -> str:
    return f"{value:.1f}%"


def aggregate_summaries(summaries: list) -> dict:
    """Aggregate multiple run summaries into one combined summary"""
    total_pnl = 0
    total_trades = 0
    total_winners = 0
    total_losers = 0
    total_decisions = 0
    total_fees = 0
    all_trades = []
    by_setup = {}
    daily_data = []

    for s in summaries:
        total_pnl += s.get('total_pnl', 0)
        total_trades += s.get('total_trades', 0)
        total_winners += s.get('winners', 0)
        total_losers += s.get('losers', 0)
        total_decisions += s.get('total_decisions', 0)
        total_fees += s.get('total_fees', 0)

        # Collect trades
        all_trades.extend(s.get('trades', []))

        # Aggregate by setup
        for setup, data in s.get('by_setup', {}).items():
            if setup not in by_setup:
                by_setup[setup] = {'pnl': 0, 'count': 0, 'wins': 0}
            by_setup[setup]['pnl'] += data.get('pnl', 0)
            by_setup[setup]['count'] += data.get('count', 0)
            by_setup[setup]['wins'] += data.get('wins', 0)

        # Daily data for charts
        daily_data.append({
            'date': s.get('date', 'Unknown'),
            'run_id': s.get('run_id'),
            'pnl': s.get('total_pnl', 0),
            'trades': s.get('total_trades', 0),
            'winners': s.get('winners', 0),
            'losers': s.get('losers', 0),
            'win_rate': s.get('win_rate', 0)
        })

    # Gross PnL is total_pnl (already includes fees in most systems)
    # Net PnL = Gross PnL - fees (if fees not already deducted)
    gross_pnl = total_pnl + total_fees  # Add back fees to get gross
    net_pnl = total_pnl  # Net is what we have after fees

    return {
        'gross_pnl': gross_pnl,
        'net_pnl': net_pnl,
        'total_pnl': total_pnl,
        'total_trades': total_trades,
        'total_winners': total_winners,
        'total_losers': total_losers,
        'win_rate': (total_winners / total_trades * 100) if total_trades else 0,
        'total_decisions': total_decisions,
        'execution_rate': (total_trades / total_decisions * 100) if total_decisions else 0,
        'total_fees': total_fees,
        'by_setup': by_setup,
        'trades': all_trades,
        'daily_data': daily_data,
        'days': len(summaries)
    }


def render_overview_tab(agg: dict):
    st.header("📊 Overview")

    # Main metrics - Gross and Net PnL
    col1, col2, col3, col4, col5, col6 = st.columns(6)
    col1.metric("Gross PnL", fmt_inr(agg['gross_pnl']))
    col2.metric("Net PnL", fmt_inr(agg['net_pnl']))
    col3.metric("Total Trades", agg['total_trades'])
    col4.metric("Win Rate", fmt_pct(agg['win_rate']))
    col5.metric("Trading Days", agg['days'])
    col6.metric("Avg PnL/Day", fmt_inr(agg['net_pnl'] / agg['days']) if agg['days'] else "N/A")

    st.divider()

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Winners", agg['total_winners'])
    col2.metric("Losers", agg['total_losers'])
    col3.metric("Total Fees", fmt_inr(agg['total_fees']))
    col4.metric("Avg PnL/Trade", fmt_inr(agg['net_pnl'] / agg['total_trades']) if agg['total_trades'] else "N/A")

    st.divider()

    # Equity curve
    daily = agg.get('daily_data', [])
    if daily:
        df = pd.DataFrame(daily)
        if 'date' in df.columns:
            df['date'] = pd.to_datetime(df['date'], errors='coerce')
            df = df.dropna(subset=['date']).sort_values('date')
            df['cumulative_pnl'] = df['pnl'].cumsum()

            st.subheader("📈 Equity Curve")
            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=df['date'], y=df['cumulative_pnl'],
                mode='lines+markers', fill='tozeroy',
                line=dict(color='#1f77b4', width=2),
                name='Cumulative PnL'
            ))
            fig.update_layout(
                template='plotly_white',
                hovermode='x unified',
                yaxis_title='Cumulative PnL (₹)',
                xaxis_title='Date'
            )
            st.plotly_chart(fig, use_container_width=True)

            st.subheader("📊 Daily PnL")
            df['color'] = df['pnl'].apply(lambda x: '#00c853' if x >= 0 else '#ff1744')
            fig = go.Figure()
            fig.add_trace(go.Bar(x=df['date'], y=df['pnl'], marker_color=df['color']))
            fig.update_layout(template='plotly_white', yaxis_title='PnL (₹)', xaxis_title='Date')
            st.plotly_chart(fig, use_container_width=True)


def render_setup_tab(agg: dict):
    st.header("🎯 Setup Analysis")

    setup_data = agg.get('by_setup', {})
    if not setup_data:
        st.warning("No setup data available")
        return

    rows = []
    for setup, data in setup_data.items():
        win_rate = data['wins'] / data['count'] * 100 if data['count'] else 0
        avg_pnl = data['pnl'] / data['count'] if data['count'] else 0
        rows.append({
            'Setup': setup,
            'Trades': data['count'],
            'PnL': data['pnl'],
            'Wins': data['wins'],
            'Win Rate': win_rate,
            'Avg PnL': avg_pnl
        })

    df = pd.DataFrame(rows).sort_values('PnL', ascending=False)

    col1, col2 = st.columns(2)
    with col1:
        fig = px.bar(df, x='Setup', y='PnL', color='PnL',
                    color_continuous_scale=['red', 'yellow', 'green'],
                    title='PnL by Setup')
        fig.update_layout(template='plotly_white', xaxis_tickangle=-45)
        st.plotly_chart(fig, use_container_width=True)
    with col2:
        fig = px.pie(df, values='Trades', names='Setup', title='Trade Distribution')
        st.plotly_chart(fig, use_container_width=True)

    # Win rate bar chart
    fig = px.bar(df, x='Setup', y='Win Rate', color='Win Rate',
                color_continuous_scale=['red', 'yellow', 'green'],
                title='Win Rate by Setup')
    fig.update_layout(template='plotly_white', xaxis_tickangle=-45)
    st.plotly_chart(fig, use_container_width=True)

    # Data table
    display_df = df.copy()
    display_df['PnL'] = display_df['PnL'].apply(fmt_inr)
    display_df['Win Rate'] = display_df['Win Rate'].apply(lambda x: f"{x:.1f}%")
    display_df['Avg PnL'] = display_df['Avg PnL'].apply(fmt_inr)
    st.dataframe(display_df, use_container_width=True, hide_index=True)


def render_daily_tab(agg: dict, runs: list, reader, config_type: str):
    st.header("📅 Daily Breakdown")

    daily = agg.get('daily_data', [])
    if not daily:
        st.warning("No daily data")
        return

    df = pd.DataFrame(daily)
    if 'date' in df.columns:
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        df = df.dropna(subset=['date']).sort_values('date', ascending=False)

    # Summary table
    display_df = df.copy()
    display_df['pnl'] = display_df['pnl'].apply(fmt_inr)
    display_df['win_rate'] = display_df['win_rate'].apply(lambda x: f"{x:.1f}%")
    display_df = display_df[['date', 'run_id', 'pnl', 'trades', 'winners', 'losers', 'win_rate']]
    display_df.columns = ['Date', 'Run ID', 'PnL', 'Trades', 'Winners', 'Losers', 'Win Rate']
    st.dataframe(display_df, use_container_width=True, hide_index=True)

    st.divider()

    # Select specific day to drill down
    st.subheader("Drill Down")
    run_ids = [r['run_id'] for r in runs]
    selected_run = st.selectbox("Select Day/Run", run_ids)

    if selected_run:
        summary = load_run_summary(reader, config_type, selected_run)

        col1, col2, col3, col4 = st.columns(4)
        col1.metric("PnL", fmt_inr(summary.get('total_pnl', 0)))
        col2.metric("Trades", summary.get('total_trades', 0))
        col3.metric("Win Rate", fmt_pct(summary.get('win_rate', 0)))
        col4.metric("W/L", f"{summary.get('winners', 0)}/{summary.get('losers', 0)}")

        trades = summary.get('trades', [])
        if trades:
            st.subheader("Trades")
            trades_df = pd.DataFrame(trades)
            if 'pnl' in trades_df.columns:
                trades_df['pnl_fmt'] = trades_df['pnl'].apply(fmt_inr)
            st.dataframe(trades_df, use_container_width=True, hide_index=True)


def render_trades_tab(agg: dict):
    st.header("📈 All Trades")

    trades = agg.get('trades', [])
    if not trades:
        st.warning("No trades data")
        return

    st.subheader(f"Total Trades: {len(trades)}")

    df = pd.DataFrame(trades)

    # PnL distribution
    if 'pnl' in df.columns:
        st.subheader("PnL Distribution")
        fig = px.histogram(df, x='pnl', nbins=30, title='Trade PnL Distribution')
        fig.update_layout(template='plotly_white', xaxis_title='PnL (₹)', yaxis_title='Count')
        st.plotly_chart(fig, use_container_width=True)

        # Stats
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Max Win", fmt_inr(df['pnl'].max()))
        col2.metric("Max Loss", fmt_inr(df['pnl'].min()))
        col3.metric("Avg Win", fmt_inr(df[df['pnl'] > 0]['pnl'].mean()) if len(df[df['pnl'] > 0]) > 0 else "N/A")
        col4.metric("Avg Loss", fmt_inr(df[df['pnl'] <= 0]['pnl'].mean()) if len(df[df['pnl'] <= 0]) > 0 else "N/A")

    # Trades table
    st.subheader("Trade List")
    display_cols = ['symbol', 'setup', 'pnl', 'exit_reason']
    available_cols = [c for c in display_cols if c in df.columns]
    display_df = df[available_cols].copy()
    if 'pnl' in display_df.columns:
        display_df['pnl'] = display_df['pnl'].apply(fmt_inr)
    st.dataframe(display_df, use_container_width=True, hide_index=True)


def render_compare_tab(reader, config_types: list):
    st.header("🔄 Compare Configs")

    comparisons = []
    for ct in config_types:
        runs = load_runs(reader, ct)
        if runs:
            summaries = load_all_summaries(reader, ct, runs)
            agg = aggregate_summaries(summaries)
            comparisons.append({
                'Config': ct,
                'Days': agg['days'],
                'Total PnL': agg['total_pnl'],
                'Total Trades': agg['total_trades'],
                'Win Rate': agg['win_rate'],
                'Avg PnL/Day': agg['total_pnl'] / agg['days'] if agg['days'] else 0
            })

    if comparisons:
        df = pd.DataFrame(comparisons)

        # Bar chart comparison
        fig = px.bar(df, x='Config', y='Total PnL', color='Total PnL',
                    color_continuous_scale=['red', 'yellow', 'green'],
                    title='Total PnL by Config')
        fig.update_layout(template='plotly_white')
        st.plotly_chart(fig, use_container_width=True)

        # Table
        display_df = df.copy()
        display_df['Total PnL'] = display_df['Total PnL'].apply(fmt_inr)
        display_df['Win Rate'] = display_df['Win Rate'].apply(lambda x: f"{x:.1f}%")
        display_df['Avg PnL/Day'] = display_df['Avg PnL/Day'].apply(fmt_inr)
        st.dataframe(display_df, use_container_width=True, hide_index=True)


def main():
    st.title("📈 Trading Dashboard")
    st.caption("Aggregated view across all trading days")

    try:
        reader = get_reader()
    except Exception as e:
        st.error(f"Failed to connect to OCI: {e}")
        return

    with st.sidebar:
        st.header("Config")

        # Load config types
        with st.spinner("Loading..."):
            config_types = load_config_types(reader)

        if not config_types:
            st.warning("No config types in bucket")
            return

        selected_config = st.selectbox("📁 Config Type", config_types)

        # Load all runs for selected config
        with st.spinner("Loading runs..."):
            runs = load_runs(reader, selected_config)

        if not runs:
            st.warning(f"No runs in {selected_config}")
            return

        # Parse dates from runs for date range filter
        run_dates = []
        for run in runs:
            ts = run.get('timestamp')
            if ts and ts != 'Unknown':
                try:
                    run_dates.append(pd.to_datetime(ts).date())
                except:
                    pass

        st.divider()
        st.subheader("📅 Date Range")

        if run_dates:
            min_date = min(run_dates)
            max_date = max(run_dates)

            date_from = st.date_input("From", value=min_date, min_value=min_date, max_value=max_date)
            date_to = st.date_input("To", value=max_date, min_value=min_date, max_value=max_date)

            # Filter runs by date range
            filtered_runs = []
            for run in runs:
                ts = run.get('timestamp')
                if ts and ts != 'Unknown':
                    try:
                        run_date = pd.to_datetime(ts).date()
                        if date_from <= run_date <= date_to:
                            filtered_runs.append(run)
                    except:
                        filtered_runs.append(run)
                else:
                    filtered_runs.append(run)
            runs = filtered_runs

        if not runs:
            st.warning("No data in selected date range")
            return

        st.success(f"📊 {len(runs)} trading days")

        st.divider()
        st.caption(f"Config: **{selected_config}**")
        st.caption(f"Days: **{len(runs)}**")

        if st.button("🔄 Refresh"):
            st.cache_data.clear()
            st.rerun()

    # Load and aggregate all summaries
    with st.spinner("Loading all data..."):
        summaries = load_all_summaries(reader, selected_config, runs)
        agg = aggregate_summaries(summaries)

    # Tabs
    tab1, tab2, tab3, tab4, tab5 = st.tabs([
        "📊 Overview", "🎯 Setups", "📅 Daily", "📈 Trades", "🔄 Compare"
    ])

    with tab1:
        render_overview_tab(agg)
    with tab2:
        render_setup_tab(agg)
    with tab3:
        render_daily_tab(agg, runs, reader, selected_config)
    with tab4:
        render_trades_tab(agg)
    with tab5:
        render_compare_tab(reader, config_types)


if __name__ == "__main__":
    main()
