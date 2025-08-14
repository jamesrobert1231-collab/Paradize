# 🎯 CO Workflow System - Viren AI Assistant Integration

## Overview
This directory contains a complete Continuous Operations (CO) workflow system for n8n that integrates with the Paradize repository and OpenAI Assistant Agent Viren.

## 📋 Workflow Files

### 1. **co-workflow-viren.json** - Core CO Workflow
- **Trigger**: Every 15 minutes
- **Focus**: Code quality, security, performance optimization
- **Integration**: GitHub issues + Viren AI analysis
- **Output**: Automated CO issues with actionable recommendations

### 2. **repo-monitoring-workflow.json** - Repository Monitoring
- **Trigger**: Every 5 minutes
- **Focus**: Infrastructure health, repository metrics
- **Integration**: Prometheus + GitHub + Viren AI
- **Output**: Health reports and infrastructure alerts

### 3. **master-co-orchestrator.json** - Master Orchestrator
- **Trigger**: Every 30 minutes
- **Focus**: Comprehensive repository analysis
- **Integration**: All systems + Viren AI
- **Output**: Master CO reports with strategic insights

## 🔧 Setup Instructions

### Prerequisites
1. **n8n** instance running
2. **GitHub API credentials** with appropriate permissions
3. **OpenAI API key** for Viren AI Assistant
4. **Prometheus workspace** configured (for infrastructure monitoring)

### Configuration Steps

#### 1. Import Workflows
```bash
# Import each workflow into n8n
# Use the JSON files provided in this directory
```

#### 2. Configure Credentials
- **GitHub API**: Create personal access token with repo permissions
- **OpenAI API**: Use your OpenAI API key
- **Prometheus**: Configure workspace ID and region

#### 3. Environment Variables
```bash
# Set these environment variables in n8n
GITHUB_OWNER=jamesrobert1231-collab
GITHUB_REPO=Paradize
PROMETHEUS_WORKSPACE_ID=ws-12345678-abcd-1234-efgh-123456789012
OPENAI_ASSISTANT_ID=asst_viren_agent
```

#### 4. Customize Labels
- **CO Issues**: `co`, `viren`, `ai-assistant`
- **Health Reports**: `health-report`, `infrastructure`
- **Master Reports**: `master-co`, `orchestrator`

## 🚀 Usage

### 1. **CO Workflow (Viren)**
- **Purpose**: Continuous code quality monitoring
- **Frequency**: Every 15 minutes
- **Actions**: Creates CO issues with AI recommendations

### 2. **Repository Monitoring**
- **Purpose**: Infrastructure and repository health
- **Frequency**: Every 5 minutes
- **Actions**: Health reports and infrastructure alerts

### 3. **Master Orchestrator**
- **Purpose**: Comprehensive repository analysis
- **Frequency**: Every 30 minutes
- **Actions**: Strategic CO reports and roadmap

## 📊 Monitoring Dashboard

### Key Metrics Tracked
- **Repository Health Score** (0-100)
- **Code Quality Index**
- **Security Vulnerability Count**
- **Performance Metrics**
- **Team Collaboration Score**

### Alerts
- **Critical Issues**: Immediate Slack notification
- **Health Degradation**: Daily reports
- **Security Vulnerabilities**: Real-time alerts

## 🔗 Integration Points

### GitHub Integration
- **Issues**: Automated creation and management
- **PRs**: Monitoring and analysis
- **Commits**: Quality checks and recommendations

### Prometheus Integration
- **Metrics**: Infrastructure monitoring
- **Alerts**: Health status tracking
- **Performance**: System optimization

### OpenAI Assistant (Viren)
- **Analysis**: AI-powered insights
- **Recommendations**: Actionable suggestions
- **Strategy**: Long-term planning

## 📈 Expected Outcomes

### Immediate Benefits
- **Automated CO issue creation**
- **Real-time infrastructure monitoring**
- **AI-powered insights and recommendations**

### Long-term Benefits
- **Improved code quality**
- **Enhanced security posture**
- **Better team collaboration**
- **Proactive issue resolution**

## 🔄 Workflow Orchestration

### Execution Flow
1. **Master Orchestrator** runs every 30 minutes
2. **CO Workflow** runs every 15 minutes
3. **Repository Monitoring** runs every 5 minutes
4. **All workflows** feed into unified reporting

### Data Flow
- **GitHub** → **n8n** → **Viren AI** → **Reports**
- **Prometheus** → **n8n** → **Viren AI** → **Alerts**
- **All sources** → **Master Orchestrator** → **Strategic insights**

## 🛠️ Troubleshooting

### Common Issues
1. **API Rate Limits**: Adjust trigger frequencies
2. **Credential Errors**: Verify API keys and permissions
3. **Workflow Failures**: Check n8n logs and error messages

### Support
- **GitHub Issues**: Use `co-support` label
- **Slack**: #co-master channel
- **Documentation**: This README file

## 📞 Contact
For support or questions about the CO workflow system, please:
1. Create an issue with label `co-support`
2. Tag @viren-ai-assistant
3. Include workflow name and error details

---

**Powered by Viren AI Assistant** 🤖
**Master CO Orchestrator** 🎯
**Continuous Operations Excellence** 🚀
