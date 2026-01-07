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
from local_reader import LocalDataReader

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


@st.cache_resource
def get_local_reader():
    return LocalDataReader()


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


CONFIG_DESCRIPTIONS = {
    'fixed': 'Fixed ₹1,000 risk per trade | 3-year backtest (2023-2025)',
    'relative': '1% capital risk per trade (₹5K for ₹5L) | 3-year backtest (2023-2025)',
    '1year': 'Fixed ₹1,000 risk per trade | 1-year backtest (2025 only)'
}


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
            st.plotly_chart(fig, width='stretch')

            st.subheader("📊 Daily PnL")
            df['color'] = df['pnl'].apply(lambda x: '#00c853' if x >= 0 else '#ff1744')
            fig = go.Figure()
            fig.add_trace(go.Bar(x=df['date'], y=df['pnl'], marker_color=df['color']))
            fig.update_layout(template='plotly_white', yaxis_title='PnL (₹)', xaxis_title='Date')
            st.plotly_chart(fig, width='stretch')


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
        st.plotly_chart(fig, width='stretch')
    with col2:
        fig = px.pie(df, values='Trades', names='Setup', title='Trade Distribution')
        st.plotly_chart(fig, width='stretch')

    # Win rate bar chart
    fig = px.bar(df, x='Setup', y='Win Rate', color='Win Rate',
                color_continuous_scale=['red', 'yellow', 'green'],
                title='Win Rate by Setup')
    fig.update_layout(template='plotly_white', xaxis_tickangle=-45)
    st.plotly_chart(fig, width='stretch')

    # Data table
    display_df = df.copy()
    display_df['PnL'] = display_df['PnL'].apply(fmt_inr)
    display_df['Win Rate'] = display_df['Win Rate'].apply(lambda x: f"{x:.1f}%")
    display_df['Avg PnL'] = display_df['Avg PnL'].apply(fmt_inr)
    st.dataframe(display_df, width='stretch', hide_index=True)


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
    st.dataframe(display_df, width='stretch', hide_index=True)

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
            st.dataframe(trades_df, width='stretch', hide_index=True)


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
        st.plotly_chart(fig, width='stretch')

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
    st.dataframe(display_df, width='stretch', hide_index=True)


def render_live_tab(local_reader: LocalDataReader):
    st.header("🔴 Live Trading")

    # Config type selector and refresh button
    col1, col2 = st.columns([3, 1])

    with col1:
        # Get available local config types
        available_configs = local_reader.list_config_types()
        if not available_configs:
            st.error("No local data found. Make sure the dashboard is running on the trading VM.")
            st.info("Expected paths:\n- ~/intraday_fixed/\n- ~/intraday/\n- ~/intraday_1year/")
            return

        selected_config = st.selectbox(
            "Config",
            available_configs,
            key="live_config_select"
        )
        local_reader.set_config_type(selected_config)

    with col2:
        st.write("")  # Spacer for alignment
        if st.button("🔄 Refresh", key="live_refresh"):
            # Set query param to stay on Live tab after refresh
            st.query_params["tab"] = "live"
            st.rerun()

    # Show config description
    if selected_config in CONFIG_DESCRIPTIONS:
        st.caption(f"ℹ️ {CONFIG_DESCRIPTIONS[selected_config]}")

    st.divider()

    # Get today's run for selected config
    today_run = local_reader.get_today_run()
    if not today_run:
        st.warning(f"No active trading session today for '{selected_config}'")

        # Show recent runs
        runs = local_reader.list_runs(limit=5)
        if runs:
            st.subheader("Recent Sessions")
            for run in runs:
                st.text(f"• {run['run_id']} ({run['timestamp']})")
        return

    st.success(f"📊 Active Session: {today_run['run_id']} ({selected_config})")

    # Get live summary
    summary = local_reader.get_live_summary(today_run['run_id'])

    if 'error' in summary:
        st.error(summary['error'])
        return

    # Main metrics
    st.subheader("💰 PnL Summary")
    col1, col2, col3, col4 = st.columns(4)

    total_pnl = summary['total_pnl']
    realized_pnl = summary['realized_pnl']
    unrealized_pnl = summary['unrealized_pnl']

    col1.metric(
        "Total PnL",
        fmt_inr(total_pnl),
        delta=f"{'↑' if total_pnl >= 0 else '↓'}"
    )
    col2.metric("Realized", fmt_inr(realized_pnl))
    col3.metric("Unrealized", fmt_inr(unrealized_pnl))
    col4.metric("Open Positions", summary['open_position_count'])

    st.divider()

    # Trade stats
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Closed Trades", summary['closed_trades'])
    col2.metric("Winners", summary['winners'])
    col3.metric("Losers", summary['losers'])
    col4.metric("Win Rate", fmt_pct(summary['win_rate']))

    st.divider()

    # Capital usage (MIS leverage = 5x, so margin required = notional / 5)
    MIS_LEVERAGE = 5
    st.subheader("💵 Capital Usage (MIS 5x)")
    notional_value = summary.get('capital_in_positions', 0)
    margin_used = notional_value / MIS_LEVERAGE
    initial_capital = summary.get('initial_capital', 0)
    available_capital = initial_capital - margin_used
    utilization_pct = (margin_used / initial_capital * 100) if initial_capital else 0

    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Initial Capital", fmt_inr(initial_capital))
    col2.metric("Margin Used", fmt_inr(margin_used), help=f"Notional: {fmt_inr(notional_value)}")
    col3.metric("Available", fmt_inr(available_capital))
    col4.metric("Utilization", fmt_pct(utilization_pct))

    st.divider()

    # Open positions table
    open_positions = summary.get('open_positions', [])
    if open_positions:
        st.subheader(f"📈 Open Positions ({len(open_positions)})")

        pos_data = []
        for pos in open_positions:
            # For price move, show raw % change
            # For PnL move, flip sign for shorts (price up = loss for short)
            price_change_pct = pos.get('price_change_pct', 0)
            side = pos['side']
            # PnL Move: positive means profit (accounts for direction)
            pnl_move_pct = -price_change_pct if side == 'SELL' else price_change_pct

            pos_data.append({
                'Symbol': pos['symbol'],
                'Side': '🔴 SHORT' if side == 'SELL' else '🟢 LONG',
                'Entry': pos['entry_price'],
                'Current': pos.get('current_price', pos['entry_price']),
                'Qty': pos.get('remaining_qty', pos['qty']),
                'Unrealized PnL': pos.get('unrealized_pnl', 0),
                'PnL %': pnl_move_pct,
                'Setup': pos.get('setup', ''),
                'Entry Time': pos.get('entry_time', '')[:19] if pos.get('entry_time') else ''
            })

        df = pd.DataFrame(pos_data)

        # Style the dataframe
        def color_pnl(val):
            if isinstance(val, (int, float)):
                color = '#00c853' if val >= 0 else '#ff1744'
                return f'color: {color}'
            return ''

        styled_df = df.style.map(color_pnl, subset=['Unrealized PnL', 'PnL %'])
        styled_df = styled_df.format({
            'Entry': '₹{:.2f}',
            'Current': '₹{:.2f}',
            'Unrealized PnL': '₹{:,.2f}',
            'PnL %': '{:+.2f}%'
        })

        st.dataframe(styled_df, width='stretch', hide_index=True)

        # Position breakdown chart
        if len(pos_data) > 1:
            fig = px.bar(
                df, x='Symbol', y='Unrealized PnL',
                color='Unrealized PnL',
                color_continuous_scale=['red', 'yellow', 'green'],
                title='Unrealized PnL by Position'
            )
            fig.update_layout(template='plotly_white')
            st.plotly_chart(fig, width='stretch')
    else:
        st.info("No open positions currently")

    # Last updated timestamp
    st.caption(f"Last updated: {summary.get('last_updated', 'Unknown')}")

    # Debug info (collapsible)
    with st.expander("Debug Info"):
        st.text(f"Tick files path: {summary.get('tick_files_path', 'N/A')}")
        st.text(f"Tick files found: {summary.get('tick_files_count', 0)}")
        st.text(f"Symbols searched: {summary.get('symbols_searched', [])}")
        st.text(f"Symbols matched: {summary.get('symbols_matched', [])}")
        st.text(f"Ticks matched: {summary.get('ticks_found', 0)} / {len(summary.get('symbols_searched', []))}")


def render_compare_tab(reader, config_types: list, date_from=None, date_to=None):
    st.header("🔄 Compare Configs")

    # Let user select which configs to compare
    selected_configs = st.multiselect(
        "Select configs to compare",
        config_types,
        default=config_types[:2] if len(config_types) >= 2 else config_types
    )

    if len(selected_configs) < 2:
        st.info("Select at least 2 configs to compare")
        return

    # Get all available dates across all selected configs
    all_dates = []
    for ct in selected_configs:
        runs = load_runs(reader, ct)
        for run in runs:
            ts = run.get('timestamp')
            if ts and ts != 'Unknown':
                try:
                    all_dates.append(pd.to_datetime(ts).date())
                except:
                    pass

    # Date range selector for comparison
    if all_dates:
        col1, col2 = st.columns(2)
        with col1:
            compare_date_from = st.date_input(
                "Compare From",
                value=min(all_dates),
                min_value=min(all_dates),
                max_value=max(all_dates),
                key="compare_date_from"
            )
        with col2:
            compare_date_to = st.date_input(
                "Compare To",
                value=max(all_dates),
                min_value=min(all_dates),
                max_value=max(all_dates),
                key="compare_date_to"
            )
    else:
        compare_date_from = date_from
        compare_date_to = date_to

    st.divider()

    # Load data for each config with date filtering
    config_data = {}
    daily_comparison = []

    for ct in selected_configs:
        runs = load_runs(reader, ct)

        # Filter by date range
        if compare_date_from and compare_date_to:
            filtered_runs = []
            for run in runs:
                ts = run.get('timestamp')
                if ts and ts != 'Unknown':
                    try:
                        run_date = pd.to_datetime(ts).date()
                        if compare_date_from <= run_date <= compare_date_to:
                            filtered_runs.append(run)
                    except:
                        filtered_runs.append(run)
            runs = filtered_runs

        if runs:
            summaries = load_all_summaries(reader, ct, runs)
            agg = aggregate_summaries(summaries)
            config_data[ct] = agg

            # Collect daily data for comparison chart
            for day in agg.get('daily_data', []):
                daily_comparison.append({
                    'config': ct,
                    'date': day.get('date'),
                    'pnl': day.get('pnl', 0),
                    'trades': day.get('trades', 0),
                    'win_rate': day.get('win_rate', 0)
                })

    if not config_data:
        st.warning("No data available for selected configs in this date range")
        return

    # Summary comparison table
    st.subheader("📊 Summary Comparison")
    comparisons = []
    for ct, agg in config_data.items():
        comparisons.append({
            'Config': ct,
            'Days': agg['days'],
            'Gross PnL': agg['gross_pnl'],
            'Net PnL': agg['net_pnl'],
            'Total Fees': agg['total_fees'],
            'Total Trades': agg['total_trades'],
            'Win Rate': agg['win_rate'],
            'Avg PnL/Day': agg['net_pnl'] / agg['days'] if agg['days'] else 0
        })

    df = pd.DataFrame(comparisons)

    # Display metrics side by side
    cols = st.columns(len(selected_configs))
    for i, ct in enumerate(selected_configs):
        if ct in config_data:
            agg = config_data[ct]
            with cols[i]:
                st.markdown(f"### {ct}")
                if ct in CONFIG_DESCRIPTIONS:
                    st.caption(CONFIG_DESCRIPTIONS[ct])
                st.metric("Net PnL", fmt_inr(agg['net_pnl']))
                st.metric("Gross PnL", fmt_inr(agg['gross_pnl']))
                st.metric("Trades", agg['total_trades'])
                st.metric("Win Rate", fmt_pct(agg['win_rate']))
                st.metric("Days", agg['days'])
                st.metric("Fees", fmt_inr(agg['total_fees']))

    st.divider()

    # Bar chart comparison
    st.subheader("📈 PnL Comparison")
    fig = px.bar(df, x='Config', y='Net PnL', color='Config',
                title='Net PnL by Config')
    fig.update_layout(template='plotly_white', showlegend=False)
    st.plotly_chart(fig, width='stretch')

    # Daily PnL comparison chart
    if daily_comparison:
        st.subheader("📅 Daily PnL Comparison")
        daily_df = pd.DataFrame(daily_comparison)
        daily_df['date'] = pd.to_datetime(daily_df['date'], errors='coerce')
        daily_df = daily_df.dropna(subset=['date']).sort_values('date')

        if not daily_df.empty:
            # Line chart comparing daily PnL
            fig = px.line(daily_df, x='date', y='pnl', color='config',
                         title='Daily PnL by Config', markers=True)
            fig.update_layout(template='plotly_white',
                            xaxis_title='Date', yaxis_title='PnL (₹)',
                            legend_title='Config')
            st.plotly_chart(fig, width='stretch')

            # Cumulative PnL comparison
            st.subheader("📈 Cumulative PnL Comparison")
            for ct in selected_configs:
                mask = daily_df['config'] == ct
                daily_df.loc[mask, 'cumulative_pnl'] = daily_df.loc[mask, 'pnl'].cumsum()

            fig = px.line(daily_df, x='date', y='cumulative_pnl', color='config',
                         title='Cumulative PnL by Config', markers=True)
            fig.update_layout(template='plotly_white',
                            xaxis_title='Date', yaxis_title='Cumulative PnL (₹)',
                            legend_title='Config')
            st.plotly_chart(fig, width='stretch')

    # Summary table
    st.subheader("📋 Comparison Table")
    display_df = df.copy()
    display_df['Gross PnL'] = display_df['Gross PnL'].apply(fmt_inr)
    display_df['Net PnL'] = display_df['Net PnL'].apply(fmt_inr)
    display_df['Total Fees'] = display_df['Total Fees'].apply(fmt_inr)
    display_df['Win Rate'] = display_df['Win Rate'].apply(lambda x: f"{x:.1f}%")
    display_df['Avg PnL/Day'] = display_df['Avg PnL/Day'].apply(fmt_inr)
    st.dataframe(display_df, width='stretch', hide_index=True)


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

        # Show config description
        if selected_config in CONFIG_DESCRIPTIONS:
            st.caption(f"ℹ️ {CONFIG_DESCRIPTIONS[selected_config]}")

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

        date_from = None
        date_to = None
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

    # Initialize local reader for live tab
    try:
        local_reader = get_local_reader()
    except:
        local_reader = None

    # Check if we should show Live tab (from refresh)
    show_live_tab = st.query_params.get("tab") == "live"
    if show_live_tab:
        # Clear the query param after reading
        st.query_params.clear()

    # Tabs - show Live tab prominently if coming from refresh
    tab_names = ["📊 Overview", "🎯 Setups", "📅 Daily", "📈 Trades", "🔄 Compare", "🔴 Live"]
    if show_live_tab:
        # Reorder to put Live first when refreshing from Live tab
        tab6, tab1, tab2, tab3, tab4, tab5 = st.tabs([
            "🔴 Live", "📊 Overview", "🎯 Setups", "📅 Daily", "📈 Trades", "🔄 Compare"
        ])
    else:
        tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs(tab_names)

    with tab1:
        if show_live_tab:
            if local_reader:
                render_live_tab(local_reader)
            else:
                st.error("Local reader not available")
        else:
            render_overview_tab(agg)
    with tab2:
        if show_live_tab:
            render_overview_tab(agg)
        else:
            render_setup_tab(agg)
    with tab3:
        if show_live_tab:
            render_setup_tab(agg)
        else:
            render_daily_tab(agg, runs, reader, selected_config)
    with tab4:
        if show_live_tab:
            render_daily_tab(agg, runs, reader, selected_config)
        else:
            render_trades_tab(agg)
    with tab5:
        if show_live_tab:
            render_trades_tab(agg)
        else:
            render_compare_tab(reader, config_types, date_from, date_to)
    with tab6:
        if show_live_tab:
            render_compare_tab(reader, config_types, date_from, date_to)
        else:
            if local_reader:
                render_live_tab(local_reader)
            else:
                st.error("Local reader not available")


if __name__ == "__main__":
    main()
