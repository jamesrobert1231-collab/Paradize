import os
import sys
import pytest

# Ensure the repository root is on the import path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from prometheus_mcp_demo import PrometheusMCPDemo


def test_demo_get_available_workspaces():
    demo = PrometheusMCPDemo()
    result = demo.demo_get_available_workspaces()
    assert "workspaces" in result
    assert isinstance(result["workspaces"], list)
    assert len(result["workspaces"]) > 0
    first = result["workspaces"][0]
    # Check some expected workspace fields
    for key in ["workspace_id", "alias", "status", "arn", "created_at"]:
        assert key in first


def test_demo_execute_query():
    demo = PrometheusMCPDemo()
    result = demo.demo_execute_query()
    assert result.get("status") == "success"
    data = result.get("data", {})
    assert "resultType" in data
    assert "result" in data


def test_demo_execute_range_query():
    demo = PrometheusMCPDemo()
    result = demo.demo_execute_range_query()
    assert result.get("status") == "success"
    data = result.get("data", {})
    assert "resultType" in data
    assert "result" in data


def test_demo_list_metrics():
    demo = PrometheusMCPDemo()
    result = demo.demo_list_metrics()
    assert "metrics" in result
    assert isinstance(result["metrics"], list)
    assert "up" in result["metrics"]


def test_demo_get_server_info():
    demo = PrometheusMCPDemo()
    result = demo.demo_get_server_info()
    assert "server_info" in result
    info = result["server_info"]
    for key in ["url", "region", "profile", "service"]:
        assert key in info
