import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(supabaseUrl, supabaseKey);

async function getExistingImage(originalImageUrl) {
    try {
        const { data, error } = await supabase
            .from('dalle_images')
            .select('dalle_image_url')
            .eq('wikipedia_image_url', originalImageUrl)
            .single();

        if (error) {
            throw error;
        }

        return data ? data.dalle_image_url : null;
    } catch (error) {
        console.error("Error in getExistingImage:", error);
        return null;
    }
}


async function generateVisionPrompt(imageUrl, articleTitle, imgDescription, openAIKey) {
    const visionApiUrl = 'https://api.openai.com/v1/chat/completions';
    try {
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
                        role: "system",
                        content: "Only output the DALLE prompt. Do not output any additional text, information, comments, style or other output. Only output the DALLE prompt. Output: [DALLE PROMPT]"
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Create a DALL-E prompt for an accurate, beautiful, realistic and more modern version of this image: '${imgDescription}' in the Wikipedia article titled: ${articleTitle}."
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
        console.log("OpenAI API response:", JSON.stringify(data));

        if (data.choices && data.choices.length > 0 && data.choices[0].message && data.choices[0].message.content) {
            let content = data.choices[0].message.content;

            // Add logic to handle different types of responses
            if (content.includes("I'm sorry, but I can't provide assistance") || content.includes("not suitable for creating images")) {
                console.error("Received a non-actionable response from OpenAI API.");
                throw new Error("Non-actionable response from OpenAI API.");
            }

            return content.trim();
        } else {
            console.error("Unexpected response structure from OpenAI API.");
            throw new Error("Unexpected response structure from OpenAI API.");
        }
    } catch (error) {
        console.error("Error in generateVisionPrompt:", error);
        throw error;
    }
}

async function generateDalleImage(prompt, openAIKey) {
    const dalleApiUrl = 'https://api.openai.com/v1/images/generations';
    try {
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
        console.log("DALL-E API response:", JSON.stringify(data));
        return data.data[0].url;
    } catch (error) {
        console.error("Error in generateDalleImage:", error);
        throw error;
    }
}

async function saveToSupabaseStorage(imageUrl, articleTitle) {
    try {
        const imageResponse = await fetch(imageUrl);
        const buffer = await imageResponse.arrayBuffer();
        const filename = `${articleTitle}/${Date.now()}-${Math.random().toString(36).substring(2, 15)}.jpg`;
        const file = new Blob([buffer], { type: 'image/jpeg' });

        const { data, error } = await supabase.storage.from('dalle_images_bucket').upload(filename, file);

        if (error) {
            console.error("Error uploading file to Supabase Storage:", error.message);
            throw error;
        }

        console.log("File successfully uploaded to Supabase Storage:", data);
        return `${supabaseUrl}/storage/v1/object/public/dalle_images_bucket/${filename}`;
    } catch (error) {
        console.error("Error in saveToSupabaseStorage:", error);
        throw error;
    }
}
function setCORSHeaders(headers) {
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
    headers.set('Access-Control-Allow-Credentials', 'true');
}

serve(async (req) => {
    const headers = new Headers();
    setCORSHeaders(headers);
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers });
    }
    if (req.method === 'GET' && req.url.includes('/get-image')) {
        const urlParams = new URL(req.url).searchParams;
        const originalImageUrl = urlParams.get('originalImageUrl');
        
        if (originalImageUrl) {
            const existingImageUrl = await getExistingImage(originalImageUrl);
            return new Response(JSON.stringify({ dalleImageUrl: existingImageUrl }), { status: 200, headers });
        }

        return new Response('Invalid request', { status: 400, headers });
    }


    if (req.method === 'POST' && req.url.includes('/dallepedia-server/generate-image')) {
        try {
            const { originalImageUrl, articleTitle, imgDescription, openAIKey } = await req.json();
            const visionPrompt = await generateVisionPrompt(originalImageUrl, articleTitle, imgDescription, openAIKey);
            const generatedImageUrl = await generateDalleImage(visionPrompt, openAIKey);
            const storedImageUrl = await saveToSupabaseStorage(generatedImageUrl, articleTitle);
            const insertResponse = await supabase
                .from('dalle_images')
                .insert([{ wikipedia_image_url: originalImageUrl, dalle_image_url: storedImageUrl, article_title: articleTitle, image_description: imgDescription }]);
            console.log("Supabase insert response:", JSON.stringify(insertResponse));
            if (insertResponse.error) throw insertResponse.error;
            return new Response(JSON.stringify({ dalleImageUrl: storedImageUrl }), { status: 200, headers });
        } catch (error) {
            console.error("Error in POST request handling:", error);
            return new Response(JSON.stringify({ error: 'Error generating image' }), { status: 500, headers });
        }
    }
    return new Response('Not Found', { status: 404, headers });
}, { port: 8080 });