document.addEventListener('DOMContentLoaded', function() {
    const saveButton = document.getElementById('saveButton');
    const apiKeyInput = document.getElementById('apiKey');
    const toggleExtension = document.getElementById('toggleExtension');
    const hoverFeature = document.getElementById('hoverFeature'); // New hover feature checkbox

    // Load the saved settings from storage
    chrome.storage.local.get(['dalleApiKey', 'isExtensionEnabled', 'hoverFeatureEnabled'], function(data) {
        apiKeyInput.value = data.dalleApiKey || '';
        toggleExtension.checked = data.isExtensionEnabled !== false; // Default to true
        hoverFeature.checked = data.hoverFeatureEnabled === true; // Default to false if undefined
    });

    // Save the API key and extension state to local storage
    saveButton.addEventListener('click', function() {
        const apiKey = apiKeyInput.value;
        chrome.storage.local.set({
            dalleApiKey: apiKey,
            hoverFeatureEnabled: hoverFeature.checked // Save hover feature state
        }, function() {
            console.log('Settings saved');
        });
    });

    // Toggle the extension state
    toggleExtension.addEventListener('change', function() {
        chrome.storage.local.set({isExtensionEnabled: toggleExtension.checked}, function() {
            console.log('Extension state changed');
        });
    });

    // Add an event listener for the hover feature checkbox (optional)
    // This can be useful if you want to save the setting immediately when changed, without requiring the save button to be clicked
    hoverFeature.addEventListener('change', function() {
        chrome.storage.local.set({hoverFeatureEnabled: hoverFeature.checked}, function() {
            console.log('Hover feature setting changed');
        });
    });
});
