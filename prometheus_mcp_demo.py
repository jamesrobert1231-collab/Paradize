#!/usr/bin/env python3
"""
Prometheus MCP Server Demonstration Script
This script demonstrates the capabilities of the Prometheus MCP server
by showing example usage patterns and expected outputs.
"""

import json
from typing import Dict, List, Any

class PrometheusMCPDemo:
    """Demonstrates Prometheus MCP server capabilities"""
    
    def __init__(self):
        self.demo_workspace_id = "ws-12345678-abcd-1234-efgh-123456789012"
        self.demo_region = "us-east-1"
    
    def demo_get_available_workspaces(self) -> Dict[str, Any]:
        """Demonstrate GetAvailableWorkspaces tool"""
        return {
            "workspaces": [
                {
                    "workspace_id": "ws-12345678-abcd-1234-efgh-123456789012",
                    "alias": "production-cluster",
                    "status": "ACTIVE",
                    "arn": "arn:aws:aps:us-east-1:123456789012:workspace/ws-12345678-abcd-1234-efgh-123456789012",
                    "created_at": "2024-01-15T10:30:00Z"
                },
                {
                    "workspace_id": "ws-87654321-dcba-4321-hgfe-210987654321",
                    "alias": "staging-cluster",
                    "status": "ACTIVE",
                    "arn": "arn:aws:aps:us-east-1:123456789012:workspace/ws-87654321-dcba-4321-hgfe-210987654321",
                    "created_at": "2024-01-20T14:45:00Z"
                }
            ]
        }
    
    def demo_execute_query(self) -> Dict[str, Any]:
        """Demonstrate ExecuteQuery tool with instant PromQL query"""
        return {
            "status": "success",
            "data": {
                "resultType": "vector",
                "result": [
                    {
                        "metric": {
                            "__name__": "up",
                            "instance": "prometheus-node-1:9100",
                            "job": "node-exporter"
                        },
                        "value": [1704067200, "1"]
                    },
                    {
                        "metric": {
                            "__name__": "up",
                            "instance": "prometheus-node-2:9100",
                            "job": "node-exporter"
                        },
                        "value": [1704067200, "1"]
                    }
                ]
            }
        }
    
    def demo_execute_range_query(self) -> Dict[str, Any]:
        """Demonstrate ExecuteRangeQuery tool with time range query"""
        return {
            "status": "success",
            "data": {
                "resultType": "matrix",
                "result": [
                    {
                        "metric": {
                            "__name__": "node_cpu_seconds_total",
                            "cpu": "0",
                            "instance": "prometheus-node-1:9100",
                            "job": "node-exporter",
                            "mode": "user"
                        },
                        "values": [
                            [1704063600, "12345.67"],
                            [1704063660, "12346.78"],
                            [1704063720, "12347.89"],
                            [1704063780, "12348.90"]
                        ]
                    }
                ]
            }
        }
    
    def demo_list_metrics(self) -> Dict[str, Any]:
        """Demonstrate ListMetrics tool"""
        return {
            "metrics": [
                "go_goroutines",
                "go_memstats_alloc_bytes",
                "node_cpu_seconds_total",
                "node_memory_MemAvailable_bytes",
                "node_network_receive_bytes_total",
                "node_network_transmit_bytes_total",
                "prometheus_http_requests_total",
                "prometheus_tsdb_head_series",
                "up"
            ]
        }
    
    def demo_get_server_info(self) -> Dict[str, Any]:
        """Demonstrate GetServerInfo tool"""
        return {
            "server_info": {
                "url": "https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-12345678-abcd-1234-efgh-123456789012",
                "region": "us-east-1",
                "profile": "default",
                "service": "aps"
            }
        }
    
    def run_all_demos(self):
        """Run all demonstration scenarios"""
        print("=== Prometheus MCP Server Demonstration ===\n")
        
        print("1. Get Available Workspaces:")
        workspaces = self.demo_get_available_workspaces()
        print(json.dumps(workspaces, indent=2))
        
        print("\n2. Execute Instant Query:")
        query_result = self.demo_execute_query()
        print(json.dumps(query_result, indent=2))
        
        print("\n3. Execute Range Query:")
        range_query_result = self.demo_execute_range_query()
        print(json.dumps(range_query_result, indent=2))
        
        print("\n4. List Available Metrics:")
        metrics = self.demo_list_metrics()
        print(json.dumps(metrics, indent=2))
        
        print("\n5. Get Server Information:")
        server_info = self.demo_get_server_info()
        print(json.dumps(server_info, indent=2))
        
        print("\n=== Usage Examples ===")
        print("""
# Example 1: Get available workspaces
workspaces = await get_available_workspaces(region="us-east-1")

# Example 2: Execute instant query
result = await execute_query(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012",
    query="up"
)

# Example 3: Execute range query
data = await execute_range_query(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012",
    query="rate(node_cpu_seconds_total[5m])",
    start="2024-01-01T00:00:00Z",
    end="2024-01-01T01:00:00Z",
    step="1m"
)

# Example 4: List metrics
metrics = await list_metrics(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012"
)

# Example 5: Get server info
info = await get_server_info(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012"
)
""")

if __name__ == "__main__":
    demo = PrometheusMCPDemo()
    demo.run_all_demos()
