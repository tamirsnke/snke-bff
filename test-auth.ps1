param (
    [string]$username = "test@example.com",
    [string]$password = "test123"
)

# Create the request body
$Body = @{
    username = $username
    password = $password
} | ConvertTo-Json

try {
    # Make the request
    $response = Invoke-RestMethod -Uri "http://localhost:3000/quentry/test-auth" -Method Post -Body $Body -ContentType "application/json"
    
    # Format and write the response to a file
    $outputPath = ".\test-auth-result.json"
    $response | ConvertTo-Json -Depth 5 | Out-File -FilePath $outputPath
    
    Write-Host "Auth test successful. Results saved to $outputPath"
    
    # Also display basic info
    Write-Host "Success: $($response.success)"
    Write-Host "Mock: $($response.mock)"
    Write-Host "SessionID: $($response.sessionId)"
    
    if ($response.user) {
        Write-Host "User info available"
    }
    
} catch {
    Write-Host "Error: $_"
    Write-Host "Status Code: $($_.Exception.Response.StatusCode.value__)"
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorContent = $reader.ReadToEnd()
        Write-Host "Error Content: $errorContent"
        $reader.Close()
    }
}
