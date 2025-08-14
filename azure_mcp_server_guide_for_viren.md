# Azure MCP Server Complete Setup Guide for Viren

## 🎯 Overview
This document contains all essential information about the Azure MCP server setup for Viren's vector storage.

## 📋 Installation Summary
- **Server Name**: github.com/Azure/azure-mcp
- **Status**: ✅ Successfully installed and configured
- **Location**: `/home/codespace/.vscode-remote/data/User/globalStorage/blackboxapp.blackboxagent/settings/blackbox_mcp_settings.json`

## 🔧 Technical Configuration
```json
{
  "mcpServers": {
    "github.com/Azure/azure-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@azure/mcp@latest",
        "server",
        "start"
      ]
    }
  }
}
```

## 🚀 Available Azure Services & Tools

### Core Azure Services
- **Azure Subscriptions**: List and manage subscriptions
- **Azure Resource Groups**: Create, list, and manage resource groups
- **Azure Storage**: Manage storage accounts, containers, blobs, tables, queues, and file shares
- **Azure SQL Database**: Manage SQL servers, databases, firewall rules, and elastic pools
- **Azure Kubernetes Service (AKS)**: List and manage AKS clusters
- **Azure Container Registry (ACR)**: List and manage container registries

### Data & Analytics
- **Azure Cosmos DB**: Manage NoSQL databases, containers, and execute queries
- **Azure Data Explorer (Kusto)**: Query clusters, databases, tables using KQL
- **Azure AI Search**: Manage search services, indexes, and execute search queries
- **Azure Monitor**: Query logs and metrics from Log Analytics workspaces

### Security & Configuration
- **Azure Key Vault**: Manage keys, secrets, and certificates
- **Azure App Configuration**: Manage configuration stores and key-value pairs
- **Azure Role-Based Access Control (RBAC)**: List role assignments and permissions

### Development & DevOps
- **Azure Developer CLI (azd)**: Execute azd commands for template management, provisioning, and deployment
- **Azure CLI Extension**: Execute any Azure CLI command directly
- **Azure Load Testing**: Create and manage load tests and test runs
- **Azure Terraform Best Practices**: Get secure, production-grade Terraform configurations

### Monitoring & Visualization
- **Azure Managed Grafana**: List and manage Grafana workspaces
- **Azure Workbooks**: Create and manage interactive dashboards and visualizations
- **Azure Virtual Desktop**: Manage host pools, session hosts, and user sessions

## 🔐 Authentication Requirements
- **Method**: Azure CLI authentication
- **Command**: `az login --use-device-code`
- **Status**: ✅ Configured and tested
- **Note**: Requires valid Azure subscription access

## 📊 Quick Start Commands

### Basic Operations
```bash
# List subscriptions
az account list

# List resource groups
az group list

# List storage accounts
az storage account list

# List SQL databases
az sql db list
```

### MCP Tool Usage Examples
```javascript
// List Azure subscriptions
use_mcp_tool({
  server_name: "github.com/Azure/azure-mcp",
  tool_name: "subscription",
  arguments: {
    command: "subscription_list",
    parameters: {}
  }
})

// List resource groups
use_mcp_tool({
  server_name: "github.com/Azure/azure-mcp",
  tool_name: "group",
  arguments: {
    command: "list",
    parameters: {}
  }
})

// List storage accounts
use_mcp_tool({
  server_name: "github.com/Azure/azure-mcp",
  tool_name: "storage",
  arguments: {
    command: "account_list",
    parameters: {}
  }
})
```

## 🎯 Key Use Cases for Viren's Projects

### 1. Infrastructure Management
- **Automated resource provisioning** for n8n workflows
- **Storage account management** for data pipelines
- **SQL database operations** for workflow data storage

### 2. Monitoring & Observability
- **Azure Monitor integration** for workflow monitoring
- **Log Analytics queries** for debugging workflows
- **Grafana dashboards** for visualization

### 3. Security & Compliance
- **Key Vault integration** for secure credential management
- **RBAC management** for access control
- **Azure Quick Review** for compliance scanning

### 4. Development Workflow
- **azd integration** for rapid prototyping
- **Container registry management** for Docker deployments
- **AKS cluster management** for scalable deployments

## 🔗 Integration Points

### With n8n Workflows
- **Azure Storage triggers** for file processing
- **SQL database connections** for data persistence
- **Key Vault secrets** for secure credential storage
- **Azure Functions** for custom logic execution

### With Prometheus Monitoring
- **Azure Monitor metrics** collection
- **Log Analytics queries** for detailed analysis
- **Custom dashboards** in Grafana

## 📚 Documentation Links
- **Official Docs**: https://learn.microsoft.com/azure/developer/azure-mcp-server/
- **GitHub Repository**: https://github.com/Azure/azure-mcp
- **Command Reference**: https://github.com/Azure/azure-mcp/blob/main/docs/azmcp-commands.md
- **Troubleshooting**: https://github.com/Azure/azure-mcp/blob/main/TROUBLESHOOTING.md

## 🚨 Important Notes
- **Telemetry**: Enabled by default (can be disabled with `AZURE_MCP_COLLECT_TELEMETRY=false`)
- **Authentication**: Uses Azure Identity SDK for secure token handling
- **Security**: Never stores or manages tokens directly
- **Updates**: Automatically uses latest version via npx

## 📞 Support & Feedback
- **Issues**: https://github.com/Azure/azure-mcp/issues/new/choose
- **Status**: Public Preview (implementation may change before GA)

---
*Generated: Azure MCP Server Setup Complete - Ready for Production Use*
