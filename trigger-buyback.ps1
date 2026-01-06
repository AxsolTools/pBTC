# Trigger buyback manually
$url = "http://localhost:3000/api/admin/trigger-buyback"

Write-Host "Triggering buyback at: $url" -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri $url -Method POST -ContentType "application/json"
    Write-Host "Success!" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10)
} catch {
    Write-Host "Error:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.ErrorDetails) {
        Write-Host $_.ErrorDetails.Message
    }
}

