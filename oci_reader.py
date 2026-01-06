"""
OCI Object Storage Reader - Stream data without local storage
=============================================================

Reads trading data directly from OCI Object Storage bucket.
No local storage required - all data streamed in memory.
"""

import json
from typing import List, Dict, Iterator, Optional
from datetime import datetime
import oci


class OCIDataReader:
    """
    Reads trading data directly from OCI Object Storage.
    No local storage required - all data streamed in memory.
    """

    def __init__(self, bucket_name: str = 'backtest-results'):
        """
        Initialize OCI client.

        Uses OCI config from:
        1. ~/.oci/config (default)
        2. Instance principal (when running on OCI)
        """
        self.bucket_name = bucket_name
        self._init_client()

    def _init_client(self):
        """Initialize OCI client with fallback to instance principal"""
        try:
            # Try config file first (for local dev)
            self.config = oci.config.from_file()
            self.os_client = oci.object_storage.ObjectStorageClient(self.config)
        except:
            # Fall back to instance principal (for OCI deployment)
            try:
                signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
                self.os_client = oci.object_storage.ObjectStorageClient(
                    config={},
                    signer=signer
                )
                self.config = None
            except Exception as e:
                raise RuntimeError(
                    f"Could not initialize OCI client. "
                    f"Ensure ~/.oci/config exists or running on OCI with instance principal. "
                    f"Error: {e}"
                )

        self.namespace = self.os_client.get_namespace().data

    def list_runs(self, limit: int = 50) -> List[Dict]:
        """
        List all available runs in the bucket.

        Returns:
            List of dicts with run_id, date_range, days, description
        """
        response = self.os_client.list_objects(
            namespace_name=self.namespace,
            bucket_name=self.bucket_name,
            delimiter='/',
            limit=1000
        )

        prefixes = response.data.prefixes or []
        runs = []

        for prefix in prefixes:
            run_id = prefix.rstrip('/')
            metadata = self._get_run_metadata(run_id)
            runs.append({
                'run_id': run_id,
                'submitted_at': metadata.get('submitted_at', 'Unknown'),
                'start_date': metadata.get('start_date', 'Unknown'),
                'end_date': metadata.get('end_date', 'Unknown'),
                'days': metadata.get('total_days', 0),
                'description': metadata.get('description', '')
            })

        # Sort by run_id descending (most recent first)
        runs.sort(key=lambda x: x['run_id'], reverse=True)
        return runs[:limit]

    def _get_run_metadata(self, run_id: str) -> Dict:
        """Get metadata for a specific run"""
        try:
            obj = self.os_client.get_object(
                namespace_name=self.namespace,
                bucket_name=self.bucket_name,
                object_name=f"{run_id}/metadata.json"
            )
            return json.loads(obj.data.content.decode('utf-8'))
        except:
            return {}

    def list_sessions(self, run_id: str) -> List[str]:
        """
        List all session dates for a run.

        Returns:
            List of date strings like ['2023-12-01', '2023-12-04', ...]
        """
        response = self.os_client.list_objects(
            namespace_name=self.namespace,
            bucket_name=self.bucket_name,
            prefix=f"{run_id}/",
            delimiter='/'
        )

        prefixes = response.data.prefixes or []
        sessions = []

        for prefix in prefixes:
            # Extract date from prefix like "run_id/2023-12-01/"
            parts = prefix.rstrip('/').split('/')
            if len(parts) >= 2:
                date_part = parts[-1]
                # Validate it looks like a date
                if len(date_part) == 10 and date_part[4] == '-':
                    sessions.append(date_part)

        sessions.sort(reverse=True)  # Most recent first
        return sessions

    def _read_object_content(self, object_name: str) -> Optional[str]:
        """Read object content as string (streamed, not saved to disk)"""
        try:
            obj = self.os_client.get_object(
                namespace_name=self.namespace,
                bucket_name=self.bucket_name,
                object_name=object_name
            )
            return obj.data.content.decode('utf-8')
        except Exception as e:
            return None

    def _stream_jsonl(self, object_name: str) -> Iterator[Dict]:
        """Stream JSONL file line by line (memory efficient)"""
        content = self._read_object_content(object_name)
        if content:
            for line in content.strip().split('\n'):
                if line:
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue

    def get_analytics(self, run_id: str, session_date: str) -> List[Dict]:
        """
        Get analytics (trade exits with PnL) for a session.

        Returns:
            List of exit events with pnl, reason, etc.
        """
        object_name = f"{run_id}/{session_date}/analytics.jsonl"
        return list(self._stream_jsonl(object_name))

    def get_events(self, run_id: str, session_date: str) -> List[Dict]:
        """
        Get all events (DECISION, TRIGGER, EXIT) for a session.

        Returns:
            List of trade lifecycle events
        """
        object_name = f"{run_id}/{session_date}/events.jsonl"
        return list(self._stream_jsonl(object_name))

    def get_decisions(self, run_id: str, session_date: str) -> List[Dict]:
        """Get decision accept/reject log"""
        object_name = f"{run_id}/{session_date}/events_decisions.jsonl"
        return list(self._stream_jsonl(object_name))

    def get_daily_summary(self, run_id: str, session_date: str) -> Dict:
        """
        Get summary metrics for a single trading day.

        Returns:
            Dict with total_pnl, trades, win_rate, setup_breakdown, etc.
        """
        analytics = self.get_analytics(run_id, session_date)

        # Extract unique trades (final exits only)
        trades = [a for a in analytics if a.get('is_final_exit')]

        if not trades:
            return {
                'date': session_date,
                'total_pnl': 0,
                'trades': 0,
                'winners': 0,
                'losers': 0,
                'win_rate': 0,
                'avg_winner': 0,
                'avg_loser': 0,
                'by_setup': {},
                'by_regime': {}
            }

        total_pnl = sum(t.get('total_trade_pnl', 0) for t in trades)
        winners = [t for t in trades if t.get('total_trade_pnl', 0) > 0]
        losers = [t for t in trades if t.get('total_trade_pnl', 0) <= 0]

        # Group by setup type
        by_setup = {}
        for t in trades:
            setup = t.get('setup_type', 'unknown')
            if setup not in by_setup:
                by_setup[setup] = {'pnl': 0, 'count': 0, 'wins': 0}
            by_setup[setup]['pnl'] += t.get('total_trade_pnl', 0)
            by_setup[setup]['count'] += 1
            if t.get('total_trade_pnl', 0) > 0:
                by_setup[setup]['wins'] += 1

        # Group by regime
        by_regime = {}
        for t in trades:
            regime = t.get('regime', 'unknown')
            if regime not in by_regime:
                by_regime[regime] = {'pnl': 0, 'count': 0}
            by_regime[regime]['pnl'] += t.get('total_trade_pnl', 0)
            by_regime[regime]['count'] += 1

        return {
            'date': session_date,
            'total_pnl': total_pnl,
            'trades': len(trades),
            'winners': len(winners),
            'losers': len(losers),
            'win_rate': len(winners) / len(trades) * 100 if trades else 0,
            'avg_winner': sum(t.get('total_trade_pnl', 0) for t in winners) / len(winners) if winners else 0,
            'avg_loser': sum(t.get('total_trade_pnl', 0) for t in losers) / len(losers) if losers else 0,
            'by_setup': by_setup,
            'by_regime': by_regime
        }

    def get_run_summary(self, run_id: str, last_n_days: int = 30) -> Dict:
        """
        Get summary metrics for entire run (or last N days).

        This is computed on-the-fly from session data, NOT stored locally.

        Returns:
            Dict with cumulative metrics
        """
        sessions = self.list_sessions(run_id)

        # Limit to last N days
        if last_n_days:
            sessions = sessions[:last_n_days]

        all_summaries = []
        cumulative_pnl = 0
        total_trades = 0
        total_winners = 0
        setup_totals = {}
        regime_totals = {}

        for session_date in sessions:
            summary = self.get_daily_summary(run_id, session_date)
            all_summaries.append(summary)

            cumulative_pnl += summary['total_pnl']
            total_trades += summary['trades']
            total_winners += summary['winners']

            # Aggregate setups
            for setup, data in summary['by_setup'].items():
                if setup not in setup_totals:
                    setup_totals[setup] = {'pnl': 0, 'count': 0, 'wins': 0}
                setup_totals[setup]['pnl'] += data['pnl']
                setup_totals[setup]['count'] += data['count']
                setup_totals[setup]['wins'] += data['wins']

            # Aggregate regimes
            for regime, data in summary['by_regime'].items():
                if regime not in regime_totals:
                    regime_totals[regime] = {'pnl': 0, 'count': 0}
                regime_totals[regime]['pnl'] += data['pnl']
                regime_totals[regime]['count'] += data['count']

        return {
            'run_id': run_id,
            'sessions_analyzed': len(sessions),
            'total_pnl': cumulative_pnl,
            'total_trades': total_trades,
            'total_winners': total_winners,
            'win_rate': total_winners / total_trades * 100 if total_trades else 0,
            'avg_pnl_per_trade': cumulative_pnl / total_trades if total_trades else 0,
            'by_setup': setup_totals,
            'by_regime': regime_totals,
            'daily_summaries': all_summaries
        }

    def get_trade_details(self, run_id: str, session_date: str, trade_id: str) -> Dict:
        """
        Get complete details for a single trade.

        Returns:
            Dict with decision, trigger, exits, derived metrics
        """
        events = self.get_events(run_id, session_date)
        analytics = self.get_analytics(run_id, session_date)

        trade = {'trade_id': trade_id, 'date': session_date}

        # Find DECISION
        for event in events:
            if event.get('trade_id') == trade_id and event.get('type') == 'DECISION':
                trade['decision'] = event.get('decision', {})
                trade['plan'] = event.get('plan', {})
                trade['bar5'] = event.get('bar5', {})
                trade['timestamp'] = event.get('ts')
                break

        # Find TRIGGER
        for event in events:
            if event.get('trade_id') == trade_id and event.get('type') == 'TRIGGER':
                trade['trigger'] = event.get('trigger', {})
                trade['trigger_timestamp'] = event.get('ts')
                break

        # Find all exits
        trade['exits'] = []
        for exit_event in analytics:
            if exit_event.get('trade_id') == trade_id:
                trade['exits'].append(exit_event)
                if exit_event.get('is_final_exit'):
                    trade['total_pnl'] = exit_event.get('total_trade_pnl', 0)

        return trade
