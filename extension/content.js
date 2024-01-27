// Helper function to get image description (placeholder - implement based on Wikipedia's structure)
console.log("Content script loaded");
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
function attachToggleButton(imgElement) {
  let toggleButton = document.createElement('button');
  toggleButton.textContent = 'Show DALLE';
  toggleButton.style.padding = '5px 10px';
  toggleButton.style.fontSize = '12px';
  toggleButton.style.background = 'rgba(0, 0, 0, 0.5)';
  toggleButton.style.color = 'white';
  toggleButton.style.border = 'none';
  toggleButton.style.borderRadius = '5px';
  toggleButton.style.cursor = 'pointer';
  toggleButton.style.position = 'absolute';
  toggleButton.style.zIndex = '1000';
  toggleButton.style.left = '0';
  toggleButton.style.top = '0';

  toggleButton.onclick = (event) => {
      toggleImageDisplay(imgElement, event, toggleButton);
  };
  imgElement.parentNode.insertBefore(toggleButton, imgElement.nextSibling);
}

// Function to switch between original and DALLE-generated images
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

      const imgDescription = getImageDescription(imgElement);
      const apiKey = await getApiKey();

      if (apiKey) {
          const loader = createLoadingIndicator();
          imgElement.parentNode.appendChild(loader);

          // First, try to retrieve existing DALL-E image URL
          const existingDalleImageUrl = await getExistingDalleImageUrl(originalSrc);
          let dalleImageUrl;
          if (existingDalleImageUrl) {
              dalleImageUrl = existingDalleImageUrl;
          } else {
              // If no existing image, generate a new one
              dalleImageUrl = await requestImageGeneration(originalSrc, articleTitle, imgDescription, apiKey);
          }

          loader.remove();
          if (dalleImageUrl) {
              imgElement.setAttribute('data-dalle-src', dalleImageUrl);
              attachToggleButton(imgElement); // Attach the toggle button only when the image is loaded
          } else {
              console.error('Failed to load DALL-E image.');
              // Optionally, change the loading indicator to an error message
          }
      } else {
          console.error('OpenAI API key is not set.');
      }
  });
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
  const articleTitle = document.querySelector('h1').innerText;

  // Selects all images that are descendants of the #bodyContent div and are visible
  const images = document.querySelectorAll('#bodyContent img:not([style*="display:none"]):not([style*="visibility:hidden"])');
  images.forEach(imgElement => {
      if (imgElement.offsetWidth > 150 && imgElement.offsetHeight > 150) { // Check if the image is larger than 150x150
          processImage(imgElement, articleTitle);
      }
});
}

init();
