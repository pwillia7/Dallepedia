    // Helper function to get image description (placeholder - implement based on Wikipedia's structure)
    console.log("Content script loaded");

    let showingDalleImages = false;

    function isDalleEnabled(callback) {
        chrome.storage.local.get('isExtensionEnabled', function(data) {
          callback(data.isExtensionEnabled !== false);
        });
      }
      

    const supabaseAuthToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjemp6a2txYWdjdXZ2cXF2d2VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDU4Njg5MDksImV4cCI6MjAyMTQ0NDkwOX0.zGPd2QV-zUf7QrXlsfde9FTivgSbRX90t2Bt0FG2yyQ'; // Securely retrieve this token

    function findLargerImageUrl(imgElement) {
        // Extract the base URL from the thumbnail image's src
        const baseUrl = imgElement.src.split('/').slice(0, -1).join('/');
        // Find the associated larger image element
        const largerImageElement = document.querySelector(`img[src^="${baseUrl}"]`);
        return largerImageElement ? largerImageElement.src : imgElement.src;
    }
        

    function getImageDescription(imgElement) {
        // For single figure
        const figureParent = imgElement.closest('figure');
        if (figureParent) {
            const figcaption = figureParent.querySelector('figcaption');
            return figcaption ? figcaption.textContent.trim() : '';
        }
    
        // For gallery
        const galleryItem = imgElement.closest('li.gallerybox');
        if (galleryItem) {
            const galleryText = galleryItem.querySelector('.gallerytext');
            return galleryText ? galleryText.textContent.trim() : '';
        }
    
        return '';
    }
        function updateLargeImage(largerImageUrl, dalleImageUrl) {
        const largeImageElement = document.querySelector(`img[src="${largerImageUrl}"]`);
        if (largeImageElement) {
            largeImageElement.src = dalleImageUrl;
            largeImageElement.setAttribute('data-dalle-src', dalleImageUrl);
        }
    }
    
                      
    function updateImages(thumbnailImgElement, largerImageUrl, dalleImageUrl) {
        if (dalleImageUrl) {
            // Update the thumbnail image
            thumbnailImgElement.src = dalleImageUrl;
            thumbnailImgElement.setAttribute('data-dalle-src', dalleImageUrl);
            thumbnailImgElement.classList.add('toggleable-image');
    
            // Update the associated larger image if it exists
            const largerImageElement = document.querySelector(`img[src^="${largerImageUrl}"]`);
            if (largerImageElement) {
                largerImageElement.src = dalleImageUrl;
                largerImageElement.setAttribute('data-dalle-src', dalleImageUrl);
                if (!largerImageElement.classList.contains('toggleable-image')) {
                    largerImageElement.classList.add('toggleable-image');
                }
            }
        } else {
            console.error('Failed to load DALL-E image.');
        }
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
            
            async function requestImageGeneration(largerImageUrl, articleTitle, imgDescription, openAIKey, width, height) {
            
                try {
                    const response = await fetch('https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/generate-image', {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'apikey': supabaseAuthToken,
                            'Authorization': `Bearer ${supabaseAuthToken}`
                        },
                        body: JSON.stringify({ 
                            originalImageUrl: largerImageUrl, 
                            articleTitle: articleTitle, 
                            imgDescription: imgDescription, 
                            openAIKey: openAIKey, 
                            width: width, 
                            height: height 
                        })
                    });
                    const data = await response.json();
                    return data.dalleImageUrl;
                } catch (error) {
                    console.error('Error generating image:', error);
                    return largerImageUrl; // Fallback to larger image on error
                }
            }
                

    // Function to retrieve existing DALLE image URL from the server
    async function getExistingDalleImageUrl(originalSrc) {
        try {
            const response = await fetch(`https://vczjzkkqagcuvvqqvweq.supabase.co/functions/v1/dallepedia-server/get-image?originalImageUrl=${encodeURIComponent(originalSrc)}`, {

            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAuthToken}`
            }
        });
        const data = await response.json();
        return data.dalleImageUrl;
        } catch (error) {
            console.error('Error retrieving image:', error);
        }
    }

    function createLargeImageToggleButton(largeImageContainer) {
        let toggleButton = document.createElement('button');
        toggleButton.id = 'toggleLargeImage';
        toggleButton.textContent = 'Toggle DALL-E Image';
        // Style the button as needed
        toggleButton.style.position = 'fixed';
        toggleButton.style.bottom = '100px';

        toggleButton.style.zIndex = '1001';
        // ... other styles ...
    
        largeImageContainer.appendChild(toggleButton);
    
        toggleButton.addEventListener('click', function() {
            const currentLargeImg = largeImageContainer.querySelector('img');
            const dalleSrc = currentLargeImg.getAttribute('data-dalle-src');
            const originalSrc = currentLargeImg.getAttribute('data-original-src');
    
            if (currentLargeImg.src === dalleSrc) {
                currentLargeImg.src = originalSrc;
                this.textContent = 'Show DALL-E Image';
            } else {
                currentLargeImg.src = dalleSrc;
                this.textContent = 'Show Original';
            }
        });
    }
    
    function createLoadingIndicator() {
        const loader = document.createElement('div');
        loader.textContent = 'Loading...';
        loader.style.position = 'absolute';
        loader.style.zIndex = '1001';
        loader.style.left = '5px';
        loader.style.top = '5px';
        loader.style.background = 'rgba(255, 255, 255, 0.7)';
        loader.style.borderRadius = '10px';
        loader.style.padding = '5px';
        loader.style.color = 'black';
        loader.style.fontSize = '12px';
        loader.style.fontWeight = 'bold';
        return loader;
    }

    async function fetchFullSizeImageDimensionsAndGenerate(fullSizeUrl, articleTitle, thumbnailImgElement, apiKey, loader) {
        const image = new Image();
        image.onload = async () => {
            const width = image.naturalWidth;
            const height = image.naturalHeight;
            const imgDescription = getImageDescription(thumbnailImgElement);
            const dalleImageUrl = await requestImageGeneration(fullSizeUrl, articleTitle, imgDescription, apiKey, width, height);
            updateImages(thumbnailImgElement, fullSizeUrl, dalleImageUrl);
            loader.remove(); // Remove loader here
        };
        image.onerror = () => {
            console.error('Error loading full-size image.');
            loader.remove();
        };
        image.src = fullSizeUrl;
    }
        function getFullSizeImageUrl(thumbnailUrl) {
        return thumbnailUrl.replace('/thumb', '').replace(/\/\d+px-.+/, '');
    }
    

    async function processImage(imgElement, articleTitle) {
        const originalSrc = imgElement.src;
        const fullSizeUrl = getFullSizeImageUrl(originalSrc); // Convert thumbnail URL to full-size URL
    
        imgElement.setAttribute('data-original-src', originalSrc);
        imgElement.setAttribute('data-larger-src', fullSizeUrl);
    
        setUpObserverOnClick(imgElement); // Set up the observer on click
    
        isDalleEnabled(async (enabled) => {
            if (!enabled) {
                console.log('DALLE generation is disabled.');
                return;
            }
    
            const loader = createLoadingIndicator();
            imgElement.parentNode.appendChild(loader);
    
            try {
                const existingDalleImageUrl = await getExistingDalleImageUrl(fullSizeUrl);
        
                if (existingDalleImageUrl) {
                    updateImages(imgElement, fullSizeUrl, existingDalleImageUrl);
                    updateLargeImage(fullSizeUrl, existingDalleImageUrl); // Update large image
                    loader.remove(); // Remove loader only after image is updated
                } else {
                    const apiKey = await getApiKey();
                    if (apiKey) {
                        fetchFullSizeImageDimensionsAndGenerate(fullSizeUrl, articleTitle, imgElement, apiKey, loader); // Pass loader to the function
                    } else {
                        console.error('OpenAI API key is not set.');
                        loader.remove();
                    }
                }
            } catch (error) {
                console.error('Error processing image:', error);
                loader.remove();
            }
        });
    }
                    
        
    function setImageAttributes(imgElement, dalleImageUrl) {
        if (dalleImageUrl) {
            imgElement.setAttribute('data-dalle-src', dalleImageUrl);
            imgElement.classList.add('toggleable-image');
        } else {
            console.error('Failed to load DALL-E image.');
        }
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
    function setUpObserverOnClick(imgElement) {
        imgElement.addEventListener('click', () => {
            // Delay to wait for the large image container to be updated
            setTimeout(() => {
                const largeImageContainer = document.querySelector('.mw-mmv-image');
                if (largeImageContainer) {
                    const largeImageElement = largeImageContainer.querySelector('img');
                    if (largeImageElement) {
                        const thumbnailDalleSrc = imgElement.getAttribute('data-dalle-src');
                        const largeImageOriginalSrc = largeImageElement.src; // Get the current src of the large image as its original source
    
                        // Set the DALL-E and original src attributes for the large image
                        largeImageElement.setAttribute('data-dalle-src', thumbnailDalleSrc);
                        largeImageElement.setAttribute('data-original-src', largeImageOriginalSrc);
    
                        // Create the toggle button if it does not exist
                        if (!document.querySelector('#toggleLargeImage')) {
                            createLargeImageToggleButton(largeImageContainer);
                        }
                    }
                }
            }, 100); // Adjust the delay time as needed
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
            style.innerHTML = '.toggleable-image { border: 2px solid blue !important; }';
            document.head.appendChild(style);
    
            attachGlobalToggleButton();

    
            const articleTitle = document.querySelector('h1').innerText;
            const images = document.querySelectorAll('#bodyContent img:not([style*="display:none"]):not([style*="visibility:hidden"])');
    
            images.forEach(imgElement => {
                if (imgElement.offsetWidth > 50 && imgElement.offsetHeight > 50) {
                    processImage(imgElement, articleTitle);
                    setUpObserverOnClick(imgElement); // Attach observer to each thumbnail

                }
            });
        });
    }
    
    init();
