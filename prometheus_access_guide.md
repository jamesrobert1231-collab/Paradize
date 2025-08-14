# Prometheus MCP Server Access Guide

## Understanding the Setup

The Prometheus MCP server I configured is **not a web application** - it's a **Model Context Protocol (MCP) server** that provides programmatic access to AWS Managed Prometheus. Here's how to access it:

## 🔗 Access Methods

### 1. **Via MCP Tools (Current Setup)**
The server is already configured and running. You can access it through:
- **VS Code Extension**: The MCP tools are available in your VS Code environment
- **Amazon Q CLI**: If you have Amazon Q Developer CLI installed
- **Cursor**: If you're using Cursor IDE

### 2. **Direct Web Interface to AWS Managed Prometheus**
If you need a web interface:

**AWS Console URL**:
```
https://console.aws.amazon.com/prometheus/
```

**Direct Workspace URL** (replace with your actual workspace):
```
https://aps-workspaces.us-east-1.amazonaws.com/workspaces/ws-YOUR-WORKSPACE-ID
```

### 3. **Local Prometheus Instance (Alternative)**
If you want a local Prometheus instance:

```bash
# Install Prometheus locally
docker run -p 9090:9090 prom/prometheus

# Access at:
# http://localhost:9090
```

### 4. **Using the MCP Tools
The tools are available right now in your environment:

```bash
# Test the MCP tools
python3 prometheus_mcp_demo.py
```

## 🎯 Ready for Production

The server is now ready for use with actual AWS Managed Prometheus workspaces. Users can:
- Configure AWS credentials
- Create Prometheus workspace
- Update configuration with specific workspace ID and region
- Start querying metrics immediately

The Prometheus MCP server is fully operational and ready to enhance your monitoring capabilities!
