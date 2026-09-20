function Test-SunnyHealthContract($Health) {
    # Compatibility is not model readiness. A stopped or unavailable current
    # bridge can safely expose local controls; an older bridge cannot.
    if ($null -eq $Health) { return $false }
    return (
        $Health.service -ceq 'paradize-sunny-local' -and
        ($Health.protocolVersion -is [int] -or $Health.protocolVersion -is [long]) -and $Health.protocolVersion -eq 2 -and
        $Health.localOnlyPolicyRequired -is [bool] -and $Health.localOnlyPolicyRequired -eq $true -and
        $Health.provider -ceq 'ollama' -and
        $Health.paidRequestsEnabled -is [bool] -and $Health.paidRequestsEnabled -eq $false -and
        $Health.status -cin @('ready','stopped','model-unavailable','ollama-unavailable','local-only-unconfirmed')
    )
}
