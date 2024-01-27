// Helper function to get image description (placeholder - implement based on Wikipedia's structure)
console.log("Content script loaded");

const supabaseAuthToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjemp6a2txYWdjdXZ2cXF2d2VxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDU4Njg5MDksImV4cCI6MjAyMTQ0NDkwOX0.zGPd2QV-zUf7QrXlsfde9FTivgSbRX90t2Bt0FG2yyQ'; // Securely retrieve this token


function getImageDescription(imgElement) {
  const figureParent = imgElement.closest('figure');
  const figcaption = figureParent ? figureParent.querySelector('figcaption') : null;
  return figcaption ? figcaption.innerText : '';
}
// Function to create and attach a toggle button to each image
function attachToggleButton(imgElement) {
  let toggleButton = document.createElement('button');
  toggleButton.textContent = 'Toggle Image';
  toggleButton.style.position = 'absolute';
  toggleButton.style.zIndex = '1000';
  toggleButton.style.left = '0'; // You might need to adjust this to position the button correctly
  toggleButton.style.top = '0';  // You might need to adjust this to position the button correctly
  toggleButton.onclick = (event) => toggleImageDisplay(imgElement, event);
  imgElement.parentNode.insertBefore(toggleButton, imgElement.nextSibling);
}
// Function to switch between original and DALLE-generated images
function toggleImageDisplay(imgElement, event) {
  event.preventDefault();
  event.stopPropagation();

  const originalSrc = imgElement.getAttribute('data-original-src');
  const dalleSrc = imgElement.getAttribute('data-dalle-src');

  if (imgElement.src === originalSrc || !dalleSrc) {
      imgElement.src = dalleSrc ? dalleSrc : originalSrc;
      // Update srcset to ensure responsive images are handled correctly
      imgElement.srcset = dalleSrc ? `${dalleSrc} 1x` : '';
  } else {
      imgElement.src = originalSrc;
      // Reset srcset when reverting to the original image
      imgElement.srcset = '';
  }
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
  loader.textContent = 'Loading...'; // Replace with a proper loader element or animation
  loader.style.position = 'absolute';
  loader.style.zIndex = 1000;
  return loader;
}

async function processImage(imgElement, articleTitle) {
  const originalSrc = imgElement.src;
  imgElement.setAttribute('data-original-src', originalSrc);

  const loader = createLoadingIndicator();
  imgElement.parentNode.appendChild(loader);

  const imgDescription = getImageDescription(imgElement);

  // Get the API key from storage
  const apiKey = await getApiKey();

  if (apiKey) {
      // First, try to retrieve existing DALL-E image URL
      const existingDalleImageUrl = await getExistingDalleImageUrl(originalSrc);
      let dalleImageUrl;
      if (existingDalleImageUrl) {
          dalleImageUrl = existingDalleImageUrl;
      } else {
          // If no existing image, generate a new one
          dalleImageUrl = await requestImageGeneration(originalSrc, articleTitle, imgDescription, apiKey);
      }
      
      imgElement.setAttribute('data-dalle-src', dalleImageUrl || originalSrc);
  } else {
      console.error('OpenAI API key is not set.');
  }

  loader.remove();
  attachToggleButton(imgElement);
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
  setTimeout(() => {
    console.log('Dallepedia running...');
    const articleTitle = document.querySelector('h1').innerText;
    const images = document.querySelectorAll('figure.mw-default-size img.mw-file-element'); 
    images.forEach(imgElement => {
        processImage(imgElement, articleTitle);
    });
  }, 1000);
}

init();
