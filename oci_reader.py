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

    Bucket structure:
        paper-trading-logs/
        ├── fixed/
        │   └── paper_20260101_084724/
        │       ├── analytics.jsonl
        │       ├── events.jsonl
        │       └── ...
        ├── relative/
        └── 1year/
    """

    def __init__(self, bucket_name: str = 'paper-trading-logs'):
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

    def list_config_types(self) -> List[str]:
        """
        List all config types (top-level folders) in the bucket.

        Returns:
            List of config type names like ['fixed', 'relative', '1year']
        """
        response = self.os_client.list_objects(
            namespace_name=self.namespace,
            bucket_name=self.bucket_name,
            delimiter='/',
            limit=100
        )

        prefixes = response.data.prefixes or []
        return [p.rstrip('/') for p in prefixes]

    def list_runs(self, config_type: str = 'fixed', limit: int = 50) -> List[Dict]:
        """
        List all available runs for a config type.

        Args:
            config_type: One of 'fixed', 'relative', '1year'
            limit: Max number of runs to return

        Returns:
            List of dicts with run_id, config_type, timestamp info
        """
        response = self.os_client.list_objects(
            namespace_name=self.namespace,
            bucket_name=self.bucket_name,
            prefix=f"{config_type}/",
            delimiter='/',
            limit=1000
        )

        prefixes = response.data.prefixes or []
        runs = []

        for prefix in prefixes:
            # Extract run_id from prefix like "fixed/paper_20260101_084724/"
            run_id = prefix.rstrip('/').split('/')[-1]

            # Parse timestamp from run_id (e.g., paper_20260101_084724 or live_20260101_084724)
            timestamp_str = None
            for prefix in ['paper_', 'live_']:
                if run_id.startswith(prefix):
                    try:
                        ts_part = run_id.replace(prefix, '')
                        timestamp_str = datetime.strptime(ts_part, '%Y%m%d_%H%M%S').isoformat()
                        break
                    except:
                        pass

            # Try to get performance.json for summary stats
            performance = self._get_performance(config_type, run_id)

            runs.append({
                'run_id': run_id,
                'config_type': config_type,
                'timestamp': timestamp_str or 'Unknown',
                'total_pnl': performance.get('total_pnl', 0),
                'total_trades': performance.get('total_trades', 0),
                'win_rate': performance.get('win_rate', 0)
            })

        # Sort by run_id descending (most recent first)
        runs.sort(key=lambda x: x['run_id'], reverse=True)
        return runs[:limit]

    def _get_performance(self, config_type: str, run_id: str) -> Dict:
        """Get performance.json for a specific run"""
        try:
            obj = self.os_client.get_object(
                namespace_name=self.namespace,
                bucket_name=self.bucket_name,
                object_name=f"{config_type}/{run_id}/performance.json"
            )
            return json.loads(obj.data.content.decode('utf-8'))
        except:
            return {}

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

    def _get_object_path(self, config_type: str, run_id: str, filename: str) -> str:
        """Build the full object path"""
        return f"{config_type}/{run_id}/{filename}"

    def get_analytics(self, config_type: str, run_id: str) -> List[Dict]:
        """
        Get analytics (trade exits with PnL) for a run.

        Returns:
            List of exit events with pnl, reason, etc.
        """
        object_name = self._get_object_path(config_type, run_id, "analytics.jsonl")
        return list(self._stream_jsonl(object_name))

    def get_events(self, config_type: str, run_id: str) -> List[Dict]:
        """
        Get all events (DECISION, TRIGGER, EXIT) for a run.

        Returns:
            List of trade lifecycle events
        """
        object_name = self._get_object_path(config_type, run_id, "events.jsonl")
        return list(self._stream_jsonl(object_name))

    def get_decisions(self, config_type: str, run_id: str) -> List[Dict]:
        """Get decision accept/reject log"""
        object_name = self._get_object_path(config_type, run_id, "events_decisions.jsonl")
        return list(self._stream_jsonl(object_name))

    def get_planning(self, config_type: str, run_id: str) -> List[Dict]:
        """Get planning data"""
        object_name = self._get_object_path(config_type, run_id, "planning.jsonl")
        return list(self._stream_jsonl(object_name))

    def get_ranking(self, config_type: str, run_id: str) -> List[Dict]:
        """Get ranking data"""
        object_name = self._get_object_path(config_type, run_id, "ranking.jsonl")
        return list(self._stream_jsonl(object_name))

    def get_scanning(self, config_type: str, run_id: str) -> List[Dict]:
        """Get scanning data"""
        object_name = self._get_object_path(config_type, run_id, "scanning.jsonl")
        return list(self._stream_jsonl(object_name))

    def get_screening(self, config_type: str, run_id: str) -> List[Dict]:
        """Get screening data"""
        object_name = self._get_object_path(config_type, run_id, "screening.jsonl")
        return list(self._stream_jsonl(object_name))

    def get_agent_log(self, config_type: str, run_id: str) -> Optional[str]:
        """Get raw agent log content"""
        object_name = self._get_object_path(config_type, run_id, "agent.log")
        return self._read_object_content(object_name)

    def get_trade_logs(self, config_type: str, run_id: str) -> Optional[str]:
        """Get raw trade logs content"""
        object_name = self._get_object_path(config_type, run_id, "trade_logs.log")
        return self._read_object_content(object_name)

    def get_performance(self, config_type: str, run_id: str) -> Dict:
        """Get performance summary"""
        return self._get_performance(config_type, run_id)

    def get_run_summary(self, config_type: str, run_id: str) -> Dict:
        """
        Get summary metrics for a run.

        First tries performance.json (pre-computed, fast).
        Falls back to computing from analytics.jsonl if needed.

        Returns:
            Dict with total_pnl, trades, win_rate, setup_breakdown, etc.
        """
        # Try performance.json first (pre-computed)
        perf = self._get_performance(config_type, run_id)
        if perf and 'summary' in perf:
            summary = perf['summary']
            trades_list = perf.get('trades', [])

            # Group by setup from trades list
            by_setup = {}
            for t in trades_list:
                setup = t.get('setup', 'unknown')
                if setup not in by_setup:
                    by_setup[setup] = {'pnl': 0, 'count': 0, 'wins': 0}
                by_setup[setup]['pnl'] += t.get('pnl', 0)
                by_setup[setup]['count'] += 1
                if t.get('pnl', 0) > 0:
                    by_setup[setup]['wins'] += 1

            return {
                'run_id': run_id,
                'config_type': config_type,
                'session_id': perf.get('session_id'),
                'capital': perf.get('capital'),  # Per-run capital for % return calc
                'total_pnl': summary.get('total_pnl', 0),
                'total_trades': summary.get('completed_trades', 0),
                'winners': summary.get('wins', 0),
                'losers': summary.get('losses', 0),
                'win_rate': summary.get('win_rate', 0) * 100,  # Convert to percentage
                'execution_rate': summary.get('execution_rate', 0) * 100,
                'total_decisions': summary.get('total_decisions', 0),
                'avg_slippage_bps': perf.get('execution', {}).get('avg_slippage_bps', 0),
                'total_fees': perf.get('execution', {}).get('total_fees', 0),
                'by_setup': by_setup,
                'trades': trades_list
            }

        # Fallback: compute from analytics.jsonl
        analytics = self.get_analytics(config_type, run_id)
        trades = [a for a in analytics if a.get('is_final_exit')]

        if not trades:
            return {
                'run_id': run_id,
                'config_type': config_type,
                'capital': None,
                'total_pnl': 0,
                'total_trades': 0,
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
            'run_id': run_id,
            'config_type': config_type,
            'capital': None,  # Not available in analytics fallback
            'total_pnl': total_pnl,
            'total_trades': len(trades),
            'winners': len(winners),
            'losers': len(losers),
            'win_rate': len(winners) / len(trades) * 100 if trades else 0,
            'avg_winner': sum(t.get('total_trade_pnl', 0) for t in winners) / len(winners) if winners else 0,
            'avg_loser': sum(t.get('total_trade_pnl', 0) for t in losers) / len(losers) if losers else 0,
            'by_setup': by_setup,
            'by_regime': by_regime
        }

    def get_trade_details(self, config_type: str, run_id: str, trade_id: str) -> Dict:
        """
        Get complete details for a single trade.

        Returns:
            Dict with decision, trigger, exits, derived metrics
        """
        events = self.get_events(config_type, run_id)
        analytics = self.get_analytics(config_type, run_id)

        trade = {'trade_id': trade_id, 'config_type': config_type, 'run_id': run_id}

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

    def list_files(self, config_type: str, run_id: str) -> List[str]:
        """List all files in a run folder"""
        response = self.os_client.list_objects(
            namespace_name=self.namespace,
            bucket_name=self.bucket_name,
            prefix=f"{config_type}/{run_id}/",
            limit=100
        )

        files = []
        for obj in response.data.objects or []:
            filename = obj.name.split('/')[-1]
            if filename:
                files.append(filename)
        return files
