    // Helper function to get image description (placeholder - implement based on Wikipedia's structure)
    console.log("Content script loaded");

    let showingDalleImages = false;

    function isDalleEnabled(callback) {
        chrome.storage.local.get('isExtensionEnabled', function(data) {
          callback(data.isExtensionEnabled !== false);
        });
      }
      

    const supabaseAuthToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjemp6a2txYWdjdXZ2cXF2d2VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDU4Njg5MDksImV4cCI6MjAyMTQ0NDkwOX0.zGPd2QV-zUf7QrXlsfde9FTivgSbRX90t2Bt0FG2yyQ'; // Securely retrieve this token

    function getImageDescription(imgElement) {
        const figureParent = imgElement.closest('figure');
        const figcaption = figureParent ? figureParent.querySelector('figcaption') : null;
        return figcaption ? figcaption.innerText : '';
      }
      
   
      
    // Function to create and attach a toggle button to each image
    function attachGlobalToggleButton() {
        let toggleButton = document.createElement('button');
        toggleButton.id = 'toggleAllImagesButton';
        toggleButton.textContent = 'Show DALLE';
        toggleButton.style.padding = '5px 10px';
        toggleButton.style.fontSize = '12px';
        toggleButton.style.background = 'rgba(0, 0, 0, 0.5)';
        toggleButton.style.color = 'white';
        toggleButton.style.border = 'none';
        toggleButton.style.borderRadius = '5px';
        toggleButton.style.cursor = 'pointer';
        toggleButton.style.position = 'fixed';
        toggleButton.style.zIndex = '1000';
        toggleButton.style.right = '10px';
        toggleButton.style.top = '10px';
      
        toggleButton.onclick = toggleAllImages;
        document.body.insertBefore(toggleButton, document.body.firstChild);
      }
          // Function to switch between original and DALLE-generated images
    function toggleAllImages() {
        const images = document.querySelectorAll('#bodyContent img[data-original-src]');
        images.forEach(imgElement => {
          const originalSrc = imgElement.getAttribute('data-original-src');
          const dalleSrc = imgElement.getAttribute('data-dalle-src');
          if (showingDalleImages) {
            imgElement.src = originalSrc;
            imgElement.srcset = originalSrc;
          } else {
            imgElement.src = dalleSrc || originalSrc;
            imgElement.srcset = dalleSrc || '';
          }
        });
        showingDalleImages = !showingDalleImages;
        document.getElementById('toggleAllImagesButton').textContent = showingDalleImages ? 'Show Original' : 'Show DALL-E';
      }

    async function requestImageGeneration(originalSrc, articleTitle, imgDescription, openAIKey) {
    try {
        const response = await fetch('https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/generate-image', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'apikey': supabaseAuthToken,
                'Authorization': `Bearer ${supabaseAuthToken}`
            },
            body: JSON.stringify({ originalImageUrl: originalSrc, articleTitle: articleTitle, imgDescription: imgDescription, openAIKey: openAIKey })
        });
        const data = await response.json();
        return data.dalleImageUrl; // Ensure this is the correct property name for the URL
    } catch (error) {
        console.error('Error generating image:', error);
        return originalSrc; // Fallback to original image on error
    }
    }


    // Function to retrieve existing DALLE image URL from the server
    async function getExistingDalleImageUrl(originalSrc) {
    try {
        const response = await fetch(`https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/get-image?originalImageUrl=${encodeURIComponent(originalSrc)}`, {

        headers: { 'Content-Type': 'application/json',     
        'Authorization': `Bearer ${supabaseAuthToken}`
        },

        
        });
        const data = await response.json();
        return data.dalleImageUrl;
    } catch (error) {
        console.error('Error retrieving image:', error);
    }
    }
    async function fetchDalleImageUrl(originalSrc, articleTitle, imgDescription) {
    try {
        const response = await fetch('https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',     
                        'Authorization': `Bearer ${supabaseAuthToken}`
            },
            body: JSON.stringify({ title: articleTitle, description: imgDescription })
        });
        const data = await response.json();
        return data.dalleImageUrl;
    } catch (error) {
        console.error('Error fetching DALLE image:', error);
        return originalSrc; // Fallback to original image on error
    }
    }

    function createLoadingIndicator() {
    const loader = document.createElement('div');
    loader.textContent = 'Loading...';
    loader.style.position = 'absolute';
    loader.style.zIndex = '1001';
    loader.style.left = '5px'; // Position it near the top-left corner of the image
    loader.style.top = '5px';
    loader.style.background = 'rgba(255, 255, 255, 0.7)';
    loader.style.borderRadius = '10px';
    loader.style.padding = '5px';
    loader.style.color = 'black';
    loader.style.fontSize = '12px';
    loader.style.fontWeight = 'bold';
    return loader;
    }

    async function processImage(imgElement, articleTitle) {
        const originalSrc = imgElement.src;
        imgElement.setAttribute('data-original-src', originalSrc);
    
        // Check if DALLE generation is enabled before processing images
        isDalleEnabled(async (enabled) => {
            if (!enabled) {
                console.log('DALLE generation is disabled.');
                return;
            }
    
            // Add a loading indicator
            const loader = createLoadingIndicator();
            imgElement.parentNode.appendChild(loader);
    
            try {
                // Attempt to fetch an existing DALL-E image URL
                const existingDalleImageUrl = await getExistingDalleImageUrl(originalSrc);
                let dalleImageUrl = existingDalleImageUrl;
    
                // If no existing DALL-E image URL is found, request image generation
                if (!existingDalleImageUrl) {
                    const apiKey = await getApiKey();
                    if (apiKey) {
                        dalleImageUrl = await requestImageGeneration(originalSrc, articleTitle, getImageDescription(imgElement), apiKey);
                    } else {
                        console.error('OpenAI API key is not set.');
                    }
                }
    
                // Remove the loading indicator
                loader.remove();
    
                // If a DALL-E image URL is available, set it as a data attribute
                if (dalleImageUrl) {
                    imgElement.setAttribute('data-dalle-src', dalleImageUrl);
                    imgElement.classList.add('toggleable-image');
                } else {
                    console.error('Failed to load DALL-E image.');
                }
                        } catch (error) {
                console.error('Error processing image:', error);
                loader.remove();
            }
        });
    }
        function toggleImageDisplay(imgElement, event, toggleButton) {
        event.preventDefault();
        event.stopPropagation();
    
        const originalSrc = imgElement.getAttribute('data-original-src');
        const dalleSrc = imgElement.getAttribute('data-dalle-src');
    
        if (imgElement.src !== originalSrc) {
            imgElement.src = originalSrc;
            imgElement.srcset = '';
            toggleButton.textContent = 'Show Original'; // When the original is displayed
        } else {
            imgElement.src = dalleSrc || originalSrc;
            imgElement.srcset = dalleSrc || '';
            toggleButton.textContent = 'Show Original'; // When the DALL-E image is displayed
        }
        }

    // Helper function to get the API key from chrome storage
    function getApiKey() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get('dalleApiKey', (data) => {
            if (data.dalleApiKey) {
                resolve(data.dalleApiKey);
            } else {
                reject('No API key found');
            }
        });
    });
    }
    function init() {
        isDalleEnabled((enabled) => {
          if (!enabled) {
            console.log('DALLE generation is disabled.');
            return;
          }
          const style = document.createElement('style');
          style.type = 'text/css';
          style.innerHTML = `
            .toggleable-image {
              border: 2px solid blue !important; /* Change color and width as needed */
            }
          `;
          document.head.appendChild(style);
          
          attachGlobalToggleButton();
      
          const articleTitle = document.querySelector('h1').innerText;
          const images = document.querySelectorAll('#bodyContent img:not([style*="display:none"]):not([style*="visibility:hidden"])');
      
          images.forEach(imgElement => {
            if (imgElement.offsetWidth > 150 && imgElement.offsetHeight > 150) {
              processImage(imgElement, articleTitle);
            }
          });
        });
      }
      
      init();
      
