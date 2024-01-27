document.addEventListener('DOMContentLoaded', function() {
    const saveButton = document.getElementById('saveButton');
    const apiKeyInput = document.getElementById('apiKey');
    const toggleExtension = document.getElementById('toggleExtension');

    // Load the saved API key and extension state from storage
    chrome.storage.local.get(['dalleApiKey', 'isExtensionEnabled'], function(data) {
        apiKeyInput.value = data.dalleApiKey || '';
        toggleExtension.checked = data.isExtensionEnabled !== false; // Default to true
    });

    // Save the API key to local storage
    saveButton.addEventListener('click', function() {
        const apiKey = apiKeyInput.value;
        chrome.storage.local.set({dalleApiKey: apiKey}, function() {
            console.log('API Key saved');
        });
    });

    // Toggle the extension state
    toggleExtension.addEventListener('change', function() {
        chrome.storage.local.set({isExtensionEnabled: toggleExtension.checked}, function() {
            console.log('Extension state changed');
        });
    });
});
