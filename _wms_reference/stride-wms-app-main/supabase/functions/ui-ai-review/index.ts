/**
 * UI AI Review Edge Function
 *
 * Performs AI-based UI screenshot review using a vision-capable model.
 * This is a gated feature that requires:
 * - ENABLE_UI_AI_REVIEW=true (server-side)
 * - User must have admin_dev role
 * - Tenant must be in allowlist (optional)
 *
 * The function:
 * 1. Receives screenshot URLs from the client
 * 2. Fetches and processes screenshots
 * 3. Sends them to a vision model for analysis
 * 4. Stores the results in ui_ai_reviews table
 * 5. Returns the review to the client
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Screenshot {
  route: string;
  viewport: string;
  url: string;
}

interface ReviewRequest {
  run_id: string;
  tenant_id: string;
  user_id: string;
  mode: 'all' | 'failed';
  screenshots: Screenshot[];
}

interface AISuggestion {
  route: string;
  viewport: string;
  category: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  recommendation: string;
}

interface AIReviewResult {
  summary: string;
  suggestions: AISuggestion[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check if feature is enabled
    const enableUIAIReview = Deno.env.get('ENABLE_UI_AI_REVIEW') === 'true';
    if (!enableUIAIReview) {
      return new Response(
        JSON.stringify({ error: 'UI AI Review feature is disabled' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: ReviewRequest = await req.json();
    const { run_id, tenant_id, user_id, mode, screenshots } = body;

    if (!run_id || !tenant_id || !user_id || !screenshots?.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: run_id, tenant_id, user_id, screenshots' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has admin_dev role
    const { data: userRoles, error: rolesError } = await supabase
      .from('user_roles')
      .select('role_id, roles(name, is_system)')
      .eq('user_id', user_id);

    if (rolesError) {
      console.error('Error checking user roles:', rolesError);
      return new Response(
        JSON.stringify({ error: 'Failed to verify user permissions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const hasAdminDev = userRoles?.some(
      (ur: any) => ur.roles?.name === 'admin_dev' && ur.roles?.is_system === true
    );

    if (!hasAdminDev) {
      return new Response(
        JSON.stringify({ error: 'User does not have admin_dev role' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create pending review record
    const { data: reviewRecord, error: insertError } = await supabase
      .from('ui_ai_reviews')
      .insert({
        run_id,
        tenant_id,
        created_by: user_id,
        status: 'pending',
        mode,
        screenshot_count: screenshots.length,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating review record:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to create review record' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get vision model API key
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    if (!anthropicApiKey && !openaiApiKey) {
      await supabase
        .from('ui_ai_reviews')
        .update({ status: 'failed', error: 'No AI API key configured' })
        .eq('id', reviewRecord.id);

      return new Response(
        JSON.stringify({ error: 'No AI API key configured for vision review' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare screenshots for analysis (limit to 20 for cost control)
    const screenshotsToAnalyze = screenshots.slice(0, 20);

    // Build the prompt for vision analysis
    const systemPrompt = `You are a UI/UX expert reviewing screenshots of a warehouse management system web application.

Your task is to analyze the provided screenshots and provide actionable suggestions for improvement.

Focus on:
1. **Layout efficiency** - Is content well-organized? Is there visual clutter?
2. **Accessibility** - Are there obvious accessibility issues beyond what automated tools catch?
3. **Contrast & Typography** - Is text readable? Are colors appropriate?
4. **Spacing & Alignment** - Is spacing consistent? Are elements aligned properly?
5. **Workflow efficiency** - Can users accomplish tasks with minimal clicks?
6. **Mobile/Touch friendliness** - Are touch targets adequate? Is spacing glove-friendly?

For each issue you identify, provide:
- The route and viewport where the issue appears
- A category (layout, accessibility, contrast, spacing, workflow, mobile)
- A severity (high, medium, low)
- A clear description of the issue
- A specific recommendation to fix it

Be concise but specific. Focus on actionable improvements.`;

    let reviewResult: AIReviewResult;
    let modelUsed = '';
    let tokensUsed = 0;

    try {
      if (anthropicApiKey) {
        // Use Claude for vision analysis
        modelUsed = 'claude-3-5-sonnet-20241022';

        const messages = [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Please review these ${screenshotsToAnalyze.length} UI screenshots from a warehouse management system. Each screenshot is labeled with its route and viewport.

Analyze them and provide:
1. An overall summary (2-3 sentences)
2. Specific suggestions for improvement

Format your response as JSON:
{
  "summary": "Overall summary here...",
  "suggestions": [
    {
      "route": "/route-path",
      "viewport": "desktop|tablet|mobile",
      "category": "layout|accessibility|contrast|spacing|workflow|mobile",
      "severity": "high|medium|low",
      "description": "What the issue is",
      "recommendation": "How to fix it"
    }
  ]
}

Screenshots to review:`,
              },
              ...screenshotsToAnalyze.map((s) => ({
                type: 'image' as const,
                source: {
                  type: 'url' as const,
                  url: s.url,
                },
              })),
              ...screenshotsToAnalyze.map((s) => ({
                type: 'text' as const,
                text: `[Above: ${s.route} (${s.viewport})]`,
              })),
            ],
          },
        ];

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelUsed,
            max_tokens: 4096,
            system: systemPrompt,
            messages,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

        // Parse the response
        const responseText = data.content?.[0]?.text || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          reviewResult = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Failed to parse AI response as JSON');
        }
      } else if (openaiApiKey) {
        // Use GPT-4 Vision as fallback
        modelUsed = 'gpt-4o';

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: modelUsed,
            max_tokens: 4096,
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Please review these ${screenshotsToAnalyze.length} UI screenshots. Format response as JSON with "summary" and "suggestions" array.`,
                  },
                  ...screenshotsToAnalyze.map((s) => ({
                    type: 'image_url' as const,
                    image_url: { url: s.url, detail: 'low' as const },
                  })),
                ],
              },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        tokensUsed = data.usage?.total_tokens || 0;
        reviewResult = JSON.parse(data.choices?.[0]?.message?.content || '{}');
      } else {
        throw new Error('No AI provider configured');
      }

      // Update the review record with results
      const { data: updatedReview, error: updateError } = await supabase
        .from('ui_ai_reviews')
        .update({
          status: 'completed',
          summary: reviewResult.summary,
          suggestions: reviewResult.suggestions,
          model_used: modelUsed,
          tokens_used: tokensUsed,
        })
        .eq('id', reviewRecord.id)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating review:', updateError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          review: updatedReview || {
            ...reviewRecord,
            status: 'completed',
            summary: reviewResult.summary,
            suggestions: reviewResult.suggestions,
          },
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (aiError) {
      console.error('AI analysis error:', aiError);

      // Update review record with error
      await supabase
        .from('ui_ai_reviews')
        .update({
          status: 'failed',
          error: aiError instanceof Error ? aiError.message : 'Unknown AI error',
        })
        .eq('id', reviewRecord.id);

      return new Response(
        JSON.stringify({ error: 'AI analysis failed', details: aiError instanceof Error ? aiError.message : 'Unknown error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
