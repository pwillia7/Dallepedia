import { serve } from "https://deno.land/std/http/server.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");



async function generateVisionPrompt(imageUrl, articleTitle, imgDescription, openAIKey) {
    const visionApiUrl = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(visionApiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAIKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "gpt-4-vision-preview",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `an excellent DALL-E 2 prompt for a modern updated version of this image of ${imgDescription} in the Wikipedia article titled ${articleTitle}.`
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageUrl,
                                detail: "high"
                            }
                        }
                    ]
                }
            ],
            max_tokens: 300
        })
    });
    const data = await response.json();
    return data.choices[0].text.trim();
}

async function generateDalleImage(prompt, openAIKey) {
    const dalleApiUrl = 'https://api.openai.com/v1/images/generations';
    const response = await fetch(dalleApiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${openAIKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: '1024x1024'
        })
    });
    const data = await response.json();
    return data.data[0].url;
}

async function saveToSupabaseStorage(imageUrl) {
    const imageResponse = await fetch(imageUrl);
    const buffer = await imageResponse.arrayBuffer();
    const filename = `dalle-images/${Date.now()}-${Math.random().toString(36).substring(2, 15)}.jpg`;

    const response = await fetch(`${supabaseUrl}/storage/v1/object/dalle_images_bucket/${filename}`, {
        method: 'POST',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        },
        body: buffer
    });
    if (response.ok) {
        return `${supabaseUrl}/storage/v1/object/dalle_images_bucket/${filename}`;
    } else {
        throw new Error('Failed to save image to Supabase Storage');
    }
}
function setCorsHeaders(headers) {
    headers.set("Access-Control-Allow-Origin", "*"); // Allows all origins
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}
serve(async (req) => {
    const headers = new Headers();
    setCorsHeaders(headers);

    if (req.method === "OPTIONS") {
        // Preflight request handling
        return new Response(null, { status: 204, headers });
    }

    if (req.method === 'POST' && req.url === '/generate-image') {
        try {
            const { originalImageUrl, articleTitle, imgDescription, openAIKey } = await req.json();
            const visionPrompt = await generateVisionPrompt(originalImageUrl, articleTitle, imgDescription, openAIKey);
            const generatedImageUrl = await generateDalleImage(visionPrompt, openAIKey);
            const storedImageUrl = await saveToSupabaseStorage(generatedImageUrl);

            const insertResponse = await fetch(`${supabaseUrl}/rest/v1/dalle_images`, {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    wikipedia_image_url: originalImageUrl,
                    dalle_image_url: storedImageUrl,
                    article_title: articleTitle,
                    image_description: imgDescription
                })
            });

            if (!insertResponse.ok) throw new Error('Failed to insert metadata into Supabase database');

            return new Response(JSON.stringify({ dalleImageUrl: storedImageUrl }), { status: 200, headers });
        } catch (error) {
            console.error('Error in image generation:', error);
            return new Response(JSON.stringify({ error: 'Error generating image' }), { status: 500, headers });
        }
    }

    return new Response('Not Found', { status: 404, headers });
}, { port: 8080 });
