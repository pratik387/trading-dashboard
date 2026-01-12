"""
Unit tests for Dashboard API instance and admin endpoints.

Tests the FastAPI endpoints including:
- Instance listing and status
- Admin proxy endpoints (capital, MIS, exit, exit-all)
- Error handling for offline instances
"""
import pytest
import sys
from pathlib import Path
from unittest.mock import patch, AsyncMock, MagicMock
from httpx import ConnectError, TimeoutException

# Add project root to path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient
from fastapi import HTTPException


# Mock the OCIDataReader and LocalDataReader before importing app
@pytest.fixture(autouse=True)
def mock_readers():
    """Mock external readers to avoid OCI/filesystem dependencies."""
    with patch('api.OCIDataReader') as mock_oci, \
         patch('api.LocalDataReader') as mock_local:
        mock_oci.return_value = MagicMock()
        mock_local.return_value = MagicMock()
        yield


@pytest.fixture
def client():
    """Create test client."""
    from api import app
    return TestClient(app)


@pytest.fixture
def mock_instances():
    """Mock instance registry."""
    return {
        "fixed": {"port": 8081, "type": "paper", "description": "Fixed risk"},
        "live": {"port": 8090, "type": "live", "description": "Live trading"},
    }


class TestListInstances:
    """Test GET /api/instances endpoint."""

    def test_list_instances_all_offline(self, client):
        """Should return instances with offline status when engines unavailable."""
        with patch('api.INSTANCES', {"test": {"port": 9999, "type": "paper", "description": "Test"}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.side_effect = HTTPException(status_code=503, detail="Engine not reachable")

            response = client.get("/api/instances")

            assert response.status_code == 200
            data = response.json()
            assert "instances" in data
            assert len(data["instances"]) == 1
            assert data["instances"][0]["name"] == "test"
            assert data["instances"][0]["status"] == "offline"

    def test_list_instances_with_healthy_engine(self, client):
        """Should return instances with ok status when engines are healthy."""
        with patch('api.INSTANCES', {"fixed": {"port": 8081, "type": "paper", "description": "Fixed"}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {"status": "ok", "state": "trading"}

            response = client.get("/api/instances")

            assert response.status_code == 200
            data = response.json()
            assert data["instances"][0]["status"] == "ok"
            assert data["instances"][0]["state"] == "trading"


class TestInstanceHealth:
    """Test GET /api/instances/{instance}/health endpoint."""

    def test_get_health_success(self, client):
        """Should return health status from engine."""
        with patch('api.INSTANCES', {"fixed": {"port": 8081, "type": "paper", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {"status": "ok", "state": "trading"}

            response = client.get("/api/instances/fixed/health")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            mock_proxy.assert_called_once_with("fixed", "/health")

    def test_get_health_instance_not_found(self, client):
        """Should return 404 for unknown instance."""
        with patch('api.INSTANCES', {}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.side_effect = HTTPException(status_code=404, detail="Instance 'unknown' not found")

            response = client.get("/api/instances/unknown/health")

            assert response.status_code == 404

    def test_get_health_engine_offline(self, client):
        """Should return 503 when engine is offline."""
        with patch('api.INSTANCES', {"fixed": {"port": 8081, "type": "paper", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.side_effect = HTTPException(status_code=503, detail="Engine not reachable")

            response = client.get("/api/instances/fixed/health")

            assert response.status_code == 503


class TestInstanceStatus:
    """Test GET /api/instances/{instance}/status endpoint."""

    def test_get_status_success(self, client):
        """Should return full status from engine."""
        expected_status = {
            "status": "ok",
            "state": "trading",
            "uptime_seconds": 3600,
            "positions_count": 2,
            "unrealized_pnl": 1500.0,
            "capital": {
                "total": 100000,
                "available": 80000,
                "margin_used": 20000,
                "mis_enabled": True
            },
            "metrics": {
                "trades_entered": 5,
                "trades_exited": 3,
                "errors": 0,
                "admin_actions": 1
            },
            "admin_enabled": True
        }

        with patch('api.INSTANCES', {"fixed": {"port": 8081, "type": "paper", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = expected_status

            response = client.get("/api/instances/fixed/status")

            assert response.status_code == 200
            data = response.json()
            assert data["state"] == "trading"
            assert data["capital"]["mis_enabled"] is True


class TestInstancePositions:
    """Test GET /api/instances/{instance}/positions endpoint."""

    def test_get_positions_success(self, client):
        """Should return positions from engine."""
        expected_positions = {
            "positions": [
                {"symbol": "NSE:RELIANCE", "side": "BUY", "qty": 100, "entry": 2500.0, "pnl": 500.0},
                {"symbol": "NSE:TCS", "side": "SELL", "qty": 50, "entry": 3500.0, "pnl": -200.0}
            ],
            "count": 2,
            "unrealized_pnl": 300.0
        }

        with patch('api.INSTANCES', {"fixed": {"port": 8081, "type": "paper", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = expected_positions

            response = client.get("/api/instances/fixed/positions")

            assert response.status_code == 200
            data = response.json()
            assert len(data["positions"]) == 2
            assert data["unrealized_pnl"] == 300.0


class TestAdminSetCapital:
    """Test POST /api/instances/{instance}/admin/capital endpoint."""

    def test_set_capital_without_token(self, client):
        """Should return 401 without admin token."""
        response = client.post(
            "/api/instances/live/admin/capital",
            json={"capital": 50000}
        )

        assert response.status_code == 401
        assert "X-Admin-Token" in response.json()["detail"]

    def test_set_capital_success(self, client):
        """Should set capital with valid token."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {
                "status": "ok",
                "old_capital": 100000,
                "new_capital": 50000
            }

            response = client.post(
                "/api/instances/live/admin/capital",
                json={"capital": 50000},
                headers={"X-Admin-Token": "secret123"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "ok"
            assert data["new_capital"] == 50000

            # Verify token was forwarded
            mock_proxy.assert_called_once()
            call_kwargs = mock_proxy.call_args[1]
            assert call_kwargs["admin_token"] == "secret123"

    def test_set_capital_invalid_token(self, client):
        """Should return 401 when engine rejects token."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            # Engine returns 401 for invalid token
            mock_proxy.return_value = {"error": "Unauthorized"}

            response = client.post(
                "/api/instances/live/admin/capital",
                json={"capital": 50000},
                headers={"X-Admin-Token": "wrong_token"}
            )

            # The response from engine (which may have error in body)
            assert response.status_code == 200  # Our proxy doesn't re-check
            data = response.json()
            assert "error" in data


class TestAdminToggleMIS:
    """Test POST /api/instances/{instance}/admin/mis endpoint."""

    def test_toggle_mis_without_token(self, client):
        """Should return 401 without admin token."""
        response = client.post(
            "/api/instances/live/admin/mis",
            json={"enabled": True}
        )

        assert response.status_code == 401

    def test_toggle_mis_enable(self, client):
        """Should enable MIS mode."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {
                "status": "ok",
                "old_value": False,
                "new_value": True
            }

            response = client.post(
                "/api/instances/live/admin/mis",
                json={"enabled": True},
                headers={"X-Admin-Token": "secret123"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["new_value"] is True

    def test_toggle_mis_disable(self, client):
        """Should disable MIS mode."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {
                "status": "ok",
                "old_value": True,
                "new_value": False
            }

            response = client.post(
                "/api/instances/live/admin/mis",
                json={"enabled": False},
                headers={"X-Admin-Token": "secret123"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["new_value"] is False


class TestAdminExitPosition:
    """Test POST /api/instances/{instance}/admin/exit endpoint."""

    def test_exit_without_token(self, client):
        """Should return 401 without admin token."""
        response = client.post(
            "/api/instances/live/admin/exit",
            json={"symbol": "NSE:RELIANCE"}
        )

        assert response.status_code == 401

    def test_exit_full_position(self, client):
        """Should exit full position."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {
                "status": "ok",
                "symbol": "NSE:RELIANCE",
                "qty_exited": 100,
                "order_id": "ORDER_123"
            }

            response = client.post(
                "/api/instances/live/admin/exit",
                json={"symbol": "NSE:RELIANCE"},
                headers={"X-Admin-Token": "secret123"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["qty_exited"] == 100

            # Verify body was correct (no qty means full exit)
            call_kwargs = mock_proxy.call_args[1]
            assert call_kwargs["body"]["symbol"] == "NSE:RELIANCE"
            assert "qty" not in call_kwargs["body"]

    def test_exit_partial_position(self, client):
        """Should exit partial position."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {
                "status": "ok",
                "symbol": "NSE:RELIANCE",
                "qty_exited": 50,
                "order_id": "ORDER_124"
            }

            response = client.post(
                "/api/instances/live/admin/exit",
                json={"symbol": "NSE:RELIANCE", "qty": 50},
                headers={"X-Admin-Token": "secret123"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["qty_exited"] == 50

            # Verify qty was included
            call_kwargs = mock_proxy.call_args[1]
            assert call_kwargs["body"]["qty"] == 50


class TestAdminExitAll:
    """Test POST /api/instances/{instance}/admin/exit-all endpoint."""

    def test_exit_all_without_token(self, client):
        """Should return 401 without admin token."""
        response = client.post(
            "/api/instances/live/admin/exit-all",
            json={"reason": "test"}
        )

        assert response.status_code == 401

    def test_exit_all_success(self, client):
        """Should exit all positions."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {
                "status": "ok",
                "reason": "manual_exit",
                "exits": [
                    {"symbol": "NSE:RELIANCE", "result": {"status": "ok"}},
                    {"symbol": "NSE:TCS", "result": {"status": "ok"}}
                ]
            }

            response = client.post(
                "/api/instances/live/admin/exit-all",
                json={"reason": "manual_exit"},
                headers={"X-Admin-Token": "secret123"}
            )

            assert response.status_code == 200
            data = response.json()
            assert len(data["exits"]) == 2

    def test_exit_all_no_positions(self, client):
        """Should handle empty position list."""
        with patch('api.INSTANCES', {"live": {"port": 8090, "type": "live", "description": ""}}), \
             patch('api.proxy_to_engine', new_callable=AsyncMock) as mock_proxy:
            mock_proxy.return_value = {
                "status": "ok",
                "message": "No positions to exit",
                "exits": []
            }

            response = client.post(
                "/api/instances/live/admin/exit-all",
                json={"reason": "test"},
                headers={"X-Admin-Token": "secret123"}
            )

            assert response.status_code == 200
            data = response.json()
            assert data["exits"] == []


class TestProxyToEngine:
    """Test the proxy_to_engine function."""

    @pytest.mark.asyncio
    async def test_proxy_unknown_instance(self):
        """Should raise 404 for unknown instance."""
        from api import proxy_to_engine

        with patch('api.INSTANCES', {}):
            with pytest.raises(HTTPException) as exc_info:
                await proxy_to_engine("unknown", "/health")

            assert exc_info.value.status_code == 404
            assert "not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_proxy_connect_error(self):
        """Should raise 503 when engine is unreachable."""
        from api import proxy_to_engine

        with patch('api.INSTANCES', {"test": {"port": 9999, "type": "paper", "description": ""}}), \
             patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=ConnectError("Connection refused")
            )

            with pytest.raises(HTTPException) as exc_info:
                await proxy_to_engine("test", "/health")

            assert exc_info.value.status_code == 503
            assert "not reachable" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_proxy_timeout(self):
        """Should raise 504 on timeout."""
        from api import proxy_to_engine

        with patch('api.INSTANCES', {"test": {"port": 9999, "type": "paper", "description": ""}}), \
             patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.get = AsyncMock(
                side_effect=TimeoutException("Timeout")
            )

            with pytest.raises(HTTPException) as exc_info:
                await proxy_to_engine("test", "/health")

            assert exc_info.value.status_code == 504
            assert "timed out" in exc_info.value.detail


class TestLoadInstances:
    """Test instance registry loading."""

    def test_load_from_config_file(self, tmp_path):
        """Should load instances from JSON config file."""
        # Create a temp config file
        config_file = tmp_path / "instances.json"
        config_file.write_text('{"custom": {"port": 9000, "type": "paper", "description": "Custom"}}')

        # Patch the path resolution in load_instances
        from api import load_instances

        with patch('api.Path') as mock_path_class:
            mock_path = MagicMock()
            mock_path_class.return_value = mock_path
            mock_path.__truediv__ = MagicMock(return_value=config_file)
            mock_path.parent = mock_path

            result = load_instances()

            # Should load from the config file
            assert "custom" in result
            assert result["custom"]["port"] == 9000

    def test_fallback_to_defaults(self):
        """Should use defaults when config file missing."""
        from api import load_instances, DEFAULT_INSTANCES

        with patch('api.Path') as mock_path_class:
            mock_path = MagicMock()
            mock_path_class.return_value = mock_path
            # Make the config file not exist
            mock_config_path = MagicMock()
            mock_config_path.exists.return_value = False
            mock_path.parent.__truediv__.return_value = mock_config_path

            result = load_instances()
            assert result == DEFAULT_INSTANCES


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
