"""
Live Trading Page - Separate page for live trading monitoring
=============================================================

This page reads from local filesystem on the trading VM.
Refresh will stay on this page (unlike tabs).
"""

import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
from local_reader import LocalDataReader

st.set_page_config(
    page_title="Live Trading",
    page_icon="🔴",
    layout="wide"
)

# Config descriptions
CONFIG_DESCRIPTIONS = {
    'fixed': 'Fixed SL/Target levels',
    'relative': 'ATR-based SL/Target',
    '1year': '1-year lookback for levels'
}


def fmt_inr(value):
    """Format number as Indian Rupees"""
    if value >= 0:
        return f"₹{value:,.2f}"
    return f"-₹{abs(value):,.2f}"


def fmt_pct(value):
    """Format as percentage"""
    return f"{value:.1f}%"


@st.cache_resource
def get_local_reader():
    return LocalDataReader()


def main():
    st.title("🔴 Live Trading")

    try:
        local_reader = get_local_reader()
    except Exception as e:
        st.error(f"Failed to initialize local reader: {e}")
        return

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

        st.dataframe(styled_df, use_container_width=True, hide_index=True)

        # Position breakdown chart
        if len(pos_data) > 1:
            fig = px.bar(
                df, x='Symbol', y='Unrealized PnL',
                color='Unrealized PnL',
                color_continuous_scale=['red', 'yellow', 'green'],
                title='Unrealized PnL by Position'
            )
            fig.update_layout(template='plotly_white')
            st.plotly_chart(fig, use_container_width=True)
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


if __name__ == "__main__":
    main()
