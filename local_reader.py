"""
Local Filesystem Reader - For live trading data from VM
========================================================

Reads trading data directly from local filesystem during live trading.
Used when logs haven't been uploaded to OCI yet (during market hours).
"""

import json
import os
from pathlib import Path
from typing import List, Dict, Iterator, Optional
from datetime import datetime
import pandas as pd


# VM paths for each config type
CONFIG_PATHS = {
    'fixed': 'intraday_fixed/intraday-trade-assistant',
    'relative': 'intraday/intraday-trade-assistant',
    '1year': 'intraday_1year/intraday-trade-assistant'
}


class LocalDataReader:
    """
    Reads trading data from local filesystem on VM.

    Directory structure per config:
        ~/intraday_fixed/intraday-trade-assistant/   (fixed)
        ~/intraday/intraday-trade-assistant/         (relative)
        ~/intraday_1year/intraday-trade-assistant/   (1year)

        Each contains:
        ├── logs/
        │   └── paper_YYYYMMDD_HHMMSS/
        │       ├── events.jsonl
        │       ├── analytics.jsonl
        │       └── ...
        └── data/sidecar/ticks/
            └── ticks_YYYYMMDD.parquet
    """

    def __init__(self, config_type: str = 'fixed'):
        """
        Initialize local reader for a specific config type.

        Args:
            config_type: One of 'fixed', 'relative', '1year'
        """
        self.config_type = config_type
        self._set_paths(config_type)

    def _set_paths(self, config_type: str):
        """Set paths based on config type"""
        if config_type in CONFIG_PATHS:
            rel_path = CONFIG_PATHS[config_type]
        else:
            rel_path = CONFIG_PATHS['fixed']

        self.base_path = Path.home() / rel_path
        self.logs_path = self.base_path / "logs"
        self.ticks_path = self.base_path / "data" / "sidecar" / "ticks"

    def set_config_type(self, config_type: str):
        """Switch to a different config type"""
        self.config_type = config_type
        self._set_paths(config_type)

    def list_config_types(self) -> List[str]:
        """List available config types that have local data"""
        available = []
        for config_type, rel_path in CONFIG_PATHS.items():
            path = Path.home() / rel_path / "logs"
            if path.exists():
                available.append(config_type)
        return available

    def is_available(self) -> bool:
        """Check if local data is accessible"""
        return self.logs_path.exists()

    def list_runs(self, config_type: str = None, limit: int = 50) -> List[Dict]:
        """
        List all available runs from local logs folder.

        Args:
            config_type: If provided, switch to this config type first
            limit: Max runs to return

        Returns:
            List of dicts with run_id, timestamp info
        """
        if config_type:
            self.set_config_type(config_type)

        if not self.logs_path.exists():
            return []

        runs = []
        for folder in self.logs_path.iterdir():
            if folder.is_dir() and folder.name.startswith('paper_'):
                run_id = folder.name

                # Parse timestamp from run_id
                timestamp_str = None
                try:
                    ts_part = run_id.replace('paper_', '')
                    timestamp_str = datetime.strptime(ts_part, '%Y%m%d_%H%M%S').isoformat()
                except:
                    pass

                runs.append({
                    'run_id': run_id,
                    'config_type': self.config_type,
                    'timestamp': timestamp_str or 'Unknown',
                    'path': str(folder)
                })

        # Sort by run_id descending (most recent first)
        runs.sort(key=lambda x: x['run_id'], reverse=True)
        return runs[:limit]

    def get_today_run(self, config_type: str = None) -> Optional[Dict]:
        """
        Get today's active run folder.

        Args:
            config_type: If provided, switch to this config type first

        Returns:
            Dict with run info or None if no run today
        """
        if config_type:
            self.set_config_type(config_type)

        today_str = datetime.now().strftime('%Y%m%d')
        runs = self.list_runs()

        for run in runs:
            if today_str in run['run_id']:
                return run
        return None

    def _read_jsonl(self, file_path: Path) -> List[Dict]:
        """Read JSONL file and return list of dicts"""
        if not file_path.exists():
            return []

        records = []
        with open(file_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        records.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        return records

    def get_events(self, run_id: str) -> List[Dict]:
        """Get all events (DECISION, TRIGGER, EXIT) for a run"""
        run_path = self.logs_path / run_id
        return self._read_jsonl(run_path / "events.jsonl")

    def get_analytics(self, run_id: str) -> List[Dict]:
        """Get analytics (trade exits with PnL) for a run"""
        run_path = self.logs_path / run_id
        return self._read_jsonl(run_path / "analytics.jsonl")

    def get_open_positions(self, run_id: str) -> List[Dict]:
        """
        Get currently open positions from events.jsonl.

        An open position is a TRIGGER event without a matching final EXIT.

        Returns:
            List of open position dicts with trade_id, symbol, entry_price, qty, side
        """
        events = self.get_events(run_id)
        analytics = self.get_analytics(run_id)

        # Find all triggered trades
        triggered = {}
        for event in events:
            if event.get('type') == 'TRIGGER':
                trade_id = event.get('trade_id')
                trigger = event.get('trigger', {})
                triggered[trade_id] = {
                    'trade_id': trade_id,
                    'symbol': event.get('symbol', '').replace('NSE:', ''),
                    'entry_price': trigger.get('actual_price', 0),
                    'qty': trigger.get('qty', 0),
                    'side': trigger.get('side', ''),
                    'setup': trigger.get('strategy', ''),
                    'entry_time': event.get('ts', '')
                }

        # Find fully closed trades from analytics (is_final_exit=True)
        closed_trade_ids = set()
        for record in analytics:
            if record.get('is_final_exit'):
                closed_trade_ids.add(record.get('trade_id'))

        # Also check EXIT events for partial closes to update remaining qty
        exit_qty = {}  # trade_id -> total exited qty
        for event in events:
            if event.get('type') == 'EXIT':
                trade_id = event.get('trade_id')
                exit_info = event.get('exit', {})
                exit_qty[trade_id] = exit_qty.get(trade_id, 0) + exit_info.get('qty', 0)

        # Filter to only open positions
        open_positions = []
        for trade_id, pos in triggered.items():
            if trade_id not in closed_trade_ids:
                # Adjust qty for partial exits
                exited = exit_qty.get(trade_id, 0)
                remaining_qty = pos['qty'] - exited
                if remaining_qty > 0:
                    pos['remaining_qty'] = remaining_qty
                    pos['exited_qty'] = exited
                    open_positions.append(pos)

        return open_positions

    def get_realized_pnl(self, run_id: str) -> float:
        """Get total realized PnL from closed trades"""
        analytics = self.get_analytics(run_id)

        total_pnl = 0
        for record in analytics:
            # Sum up PnL from all exits
            total_pnl += record.get('pnl', 0)

        return total_pnl

    def get_latest_ticks(self, symbols: List[str], date: datetime = None) -> Dict[str, Dict]:
        """
        Get latest tick data for given symbols.

        Tick files are partitioned: ticks_YYYYMMDD.part1.parquet, ticks_YYYYMMDD.part2.parquet, etc.
        Reads the most recent partition(s) to find latest prices.

        Args:
            symbols: List of symbol names (without NSE: prefix)
            date: Date for tick file (defaults to today)

        Returns:
            Dict mapping symbol -> {price, volume, ts}
        """
        if date is None:
            date = datetime.now()

        date_str = date.strftime('%Y%m%d')

        # Find all tick files for this date (partitioned files)
        tick_files = sorted(
            self.ticks_path.glob(f"ticks_{date_str}*.parquet"),
            key=lambda x: x.stat().st_mtime,
            reverse=True  # Most recent first
        )

        if not tick_files:
            return {}

        try:
            latest_ticks = {}
            symbols_to_find = set(s.replace('NSE:', '') for s in symbols)

            # Build symbol variants for matching (both with and without NSE: prefix)
            symbol_variants_map = {}
            for symbol in symbols_to_find:
                symbol_variants_map[symbol] = [symbol, f'NSE:{symbol}']

            # Read the most recent partition files (limit to last 5 for performance)
            # Since files are sorted by mtime desc, the first few have the latest data
            for tick_file in tick_files[:5]:
                if not symbols_to_find:
                    break  # Found all symbols

                df = pd.read_parquet(tick_file)

                for symbol in list(symbols_to_find):
                    variants = symbol_variants_map.get(symbol, [symbol])

                    for variant in variants:
                        mask = df['symbol'] == variant
                        if mask.any():
                            symbol_df = df[mask].sort_values('ts')
                            latest = symbol_df.iloc[-1]

                            # Check if this tick is newer than what we already have
                            current_ts = str(latest['ts'])
                            if symbol in latest_ticks:
                                if current_ts > latest_ticks[symbol]['ts']:
                                    latest_ticks[symbol] = {
                                        'price': float(latest['price']),
                                        'volume': int(latest.get('volume', 0)),
                                        'ts': current_ts
                                    }
                            else:
                                latest_ticks[symbol] = {
                                    'price': float(latest['price']),
                                    'volume': int(latest.get('volume', 0)),
                                    'ts': current_ts
                                }
                                symbols_to_find.discard(symbol)
                            break

            return latest_ticks
        except Exception as e:
            return {}

    def calculate_unrealized_pnl(self, positions: List[Dict], ticks: Dict[str, Dict]) -> List[Dict]:
        """
        Calculate unrealized PnL for open positions using current tick prices.

        Args:
            positions: List of open positions from get_open_positions()
            ticks: Latest tick data from get_latest_ticks()

        Returns:
            Positions list with unrealized_pnl added
        """
        for pos in positions:
            symbol = pos['symbol']
            tick = ticks.get(symbol)

            if tick:
                current_price = tick['price']
                entry_price = pos['entry_price']
                qty = pos.get('remaining_qty', pos['qty'])
                side = pos['side']

                # Calculate PnL based on direction
                # SELL = short (profit when price goes down)
                # BUY = long (profit when price goes up)
                if side == 'SELL':
                    pos['unrealized_pnl'] = (entry_price - current_price) * qty
                else:
                    pos['unrealized_pnl'] = (current_price - entry_price) * qty

                pos['current_price'] = current_price
                pos['price_change'] = current_price - entry_price
                pos['price_change_pct'] = ((current_price - entry_price) / entry_price) * 100
            else:
                pos['unrealized_pnl'] = 0
                pos['current_price'] = pos['entry_price']
                pos['price_change'] = 0
                pos['price_change_pct'] = 0

        return positions

    def get_agent_log(self, run_id: str) -> Optional[str]:
        """Get raw agent log content"""
        run_path = self.logs_path / run_id
        log_file = run_path / "agent.log"
        if log_file.exists():
            return log_file.read_text(encoding='utf-8', errors='ignore')
        return None

    def get_config(self) -> Dict:
        """
        Read configuration.json for the current config type.

        Returns:
            Dict with configuration or empty dict if not found
        """
        config_file = self.base_path / "config" / "configuration.json"
        if config_file.exists():
            try:
                return json.loads(config_file.read_text(encoding='utf-8'))
            except:
                pass
        return {}

    def get_initial_capital(self) -> float:
        """
        Get initial capital from configuration.json.

        Reads from: capital_management.initial_capital

        Returns:
            Initial capital amount or 500000 as default
        """
        config = self.get_config()
        cap_mgmt = config.get('capital_management', {})
        return cap_mgmt.get('initial_capital', 500000)

    def get_live_summary(self, run_id: str = None) -> Dict:
        """
        Get complete live trading summary.

        Args:
            run_id: Specific run to get summary for (defaults to today's run)

        Returns:
            Dict with realized_pnl, unrealized_pnl, open_positions, etc.
        """
        if run_id is None:
            today_run = self.get_today_run()
            if not today_run:
                return {'error': 'No active run today'}
            run_id = today_run['run_id']

        # Get open positions
        open_positions = self.get_open_positions(run_id)

        # Get latest ticks for open positions
        symbols = [p['symbol'] for p in open_positions]
        ticks = self.get_latest_ticks(symbols) if symbols else {}

        # Calculate unrealized PnL
        open_positions = self.calculate_unrealized_pnl(open_positions, ticks)

        # Get realized PnL
        realized_pnl = self.get_realized_pnl(run_id)

        # Calculate totals
        total_unrealized = sum(p.get('unrealized_pnl', 0) for p in open_positions)
        total_pnl = realized_pnl + total_unrealized

        # Get trade counts from analytics
        analytics = self.get_analytics(run_id)
        closed_trades = [a for a in analytics if a.get('is_final_exit')]
        winners = sum(1 for t in closed_trades if t.get('total_trade_pnl', 0) > 0)
        losers = sum(1 for t in closed_trades if t.get('total_trade_pnl', 0) <= 0)

        # Calculate capital used from open positions (entry_price * qty)
        capital_in_positions = sum(
            p['entry_price'] * p.get('remaining_qty', p['qty'])
            for p in open_positions
        )

        # Get initial capital from config
        initial_capital = self.get_initial_capital()
        available_capital = initial_capital - capital_in_positions

        # Debug info for tick data
        date_str = datetime.now().strftime('%Y%m%d')
        tick_files = list(self.ticks_path.glob(f"ticks_{date_str}*.parquet"))

        return {
            'run_id': run_id,
            'realized_pnl': realized_pnl,
            'unrealized_pnl': total_unrealized,
            'total_pnl': total_pnl,
            'open_positions': open_positions,
            'open_position_count': len(open_positions),
            'closed_trades': len(closed_trades),
            'winners': winners,
            'losers': losers,
            'win_rate': (winners / len(closed_trades) * 100) if closed_trades else 0,
            'initial_capital': initial_capital,
            'capital_in_positions': capital_in_positions,
            'available_capital': available_capital,
            'capital_utilization_pct': (capital_in_positions / initial_capital * 100) if initial_capital else 0,
            'tick_files_count': len(tick_files),
            'tick_files_path': str(self.ticks_path),
            'ticks_found': len(ticks),
            'symbols_searched': symbols,
            'symbols_matched': list(ticks.keys()),
            'last_updated': datetime.now().isoformat()
        }
