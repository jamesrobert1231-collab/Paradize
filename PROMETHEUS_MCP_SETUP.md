# Prometheus MCP Server Setup - Complete Guide

## ✅ Setup Complete

The Prometheus MCP server from AWS Labs has been successfully installed and configured with the following details:

### 📋 Installation Summary

**Server Name**: `github.com/awslabs/mcp/tree/main/src/prometheus-mcp-server`
**Configuration File**: `/home/codespace/.vscode-remote/data/User/globalStorage/blackboxapp.blackboxagent/settings/blackbox_mcp_settings.json`

### 🔧 Configuration Details

```json
{
  "mcpServers": {
    "github.com/awslabs/mcp/tree/main/src/prometheus-mcp-server": {
      "command": "/home/codespace/.local/bin/uvx",
      "args": [
        "awslabs.prometheus-mcp-server@latest"
      ],
      "env": {
        "FASTMCP_LOG_LEVEL": "DEBUG"
      }
    }
  }
}
```

### 🚀 Available Tools

The Prometheus MCP server provides the following tools:

1. **GetAvailableWorkspaces** - List all available Prometheus workspaces
2. **ExecuteQuery** - Execute instant PromQL queries
3. **ExecuteRangeQuery** - Execute PromQL queries over time ranges
4. **ListMetrics** - Retrieve all available metric names
5. **GetServerInfo** - Get server configuration details

### 📊 Usage Examples

#### 1. Get Available Workspaces
```python
workspaces = await get_available_workspaces(region="us-east-1")
```

#### 2. Execute Instant Query
```python
result = await execute_query(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012",
    query="up"
)
```

#### 3. Execute Range Query
```python
data = await execute_range_query(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012",
    query="rate(node_cpu_seconds_total[5m])",
    start="2024-01-01T00:00:00Z",
    end="2024-01-01T01:00:00Z",
    step="1m"
)
```

#### 4. List Metrics
```python
metrics = await list_metrics(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012"
)
```

#### 5. Get Server Info
```python
info = await get_server_info(
    workspace_id="ws-12345678-abcd-1234-efgh-123456789012"
)
```

### 🔍 Prerequisites for Production Use

To use this server with actual AWS Managed Prometheus:

1. **AWS Credentials**: Configure AWS CLI with appropriate permissions
2. **Prometheus Workspace**: Create an AWS Managed Prometheus workspace
3. **IAM Permissions**: Ensure your AWS profile has necessary permissions for Amazon Managed Service for Prometheus

### 📁 Files Created

- `prometheus_mcp_demo.py` - Demonstration script showing all capabilities
- `PROMETHEUS_MCP_SETUP.md` - This setup documentation

### 🎯 Next Steps

1. Configure AWS credentials: `aws configure`
2. Create a Prometheus workspace in AWS Console
3. Update the MCP configuration with your specific workspace ID and region
4. Start querying your metrics!

### 🔧 Advanced Configuration

For production use with specific workspace:

```json
{
  "mcpServers": {
    "github.com/awslabs/mcp/tree/main/src/prometheus-mcp-server": {
      "command": "/home/codespace/.local/bin/uvx",
      "args": [
        "awslabs.prometheus-mcp-server@latest",
        "--url",
        "https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-YOUR-WORKSPACE-ID",
        "--region",
        "us-east-1",
        "--profile",
        "default"
      ],
      "env": {
        "FASTMCP_LOG_LEVEL": "DEBUG"
      }
    }
  }
}
```

### 🐛 Troubleshooting

- **Connection Issues**: Ensure AWS credentials are properly configured
- **Permission Errors**: Check IAM permissions for Prometheus access
- **Region Issues**: Verify the correct AWS region is specified
