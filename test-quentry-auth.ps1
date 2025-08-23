# Test Quentry Authentication PowerShell Script

$credential = @{
    username = "bff.bff"
    password = "Paris123"
}

# Convert to JSON
$jsonCredential = $credential | ConvertTo-Json

# Call the BFF test-auth endpoint
$response = Invoke-WebRequest -Uri "http://localhost:3000/quentry/test-auth" -Method Post -Body $jsonCredential -ContentType "application/json"

# Output response
Write-Host "Status: $($response.StatusCode)"
Write-Host "Response: $($response.Content)"
