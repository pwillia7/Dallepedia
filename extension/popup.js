document.getElementById('saveButton').addEventListener('click', function() {
    var apiKey = document.getElementById('apiKey').value;
    chrome.storage.local.set({dalleApiKey: apiKey}, function() {
        console.log('API Key saved');
    });
});
