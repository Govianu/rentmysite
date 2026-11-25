// Drafts the WhatsApp reply sent while the assigned employee hasn't answered yet, and classifies the lead.
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { db } = require('./store');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
let client = null;

const Reply = z.object({
  reply: z.string().describe('The WhatsApp message to send. Empty string if nothing should be sent.'),
  stage: z
    .enum(['engaged', 'qualified', 'not_interested', 'needs_human', 'no_reply_needed'])
    .describe(
      'engaged = conversation going; qualified = interested and gave details or agreed to a call; not_interested = declined; ' +
        'needs_human = something only staff can answer (exact price, legal, complaint, payment); no_reply_needed = "ok", "thanks", stickers.',
    ),
  brand: z.enum(['rentmysite', 'pmb', 'unknown']).describe('Which business this person is talking about.'),
  summary: z.string().describe('One line for the team: who this is, what they want, what is known so far.'),
});

const SYSTEM = `You reply on WhatsApp for Govianu (Bengaluru, India) on behalf of two businesses, while the assigned team member is busy. The team member will follow up, so hold the conversation warmly and collect details.

RentMySite (rentmysite.ai) – for property/space OWNERS:
- NOT a listing portal like MagicBricks or 99acres; no fixed monthly rent (rents keep changing).
- Works on REVENUE SHARING: using AI, a dormant space is put to work across multiple income streams.
  Empty office -> co-working, meetings, events. Empty flat -> short stay, service apartment, events. Land -> multiple revenue streams. Running business -> another business in the unused part.
- Collect: property type, location, size, current use, openness to revenue sharing.

PartnerMyBusiness (partnermybusiness.ai) – a business + professional (associate) partnership marketplace: businesses grow through partners/associates, professionals find business partnerships.
- Collect: their business or profession, city, what kind of partnership they want.

How to reply:
- Short WhatsApp style, 1-4 lines, polite Indian English. Match the customer's language if they write in Hindi/Kannada/Tamil/Telugu.
- When they are interested or ask for details, say our team member will call them shortly from our number.
- Never invent prices, figures, availability, legal facts or commitments; say the team will share exact details on the call.
- Don't repeat a pitch already sent. If asked whether you are a bot, say you are the Govianu assistant and a team member will call.`;

function aiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function draftReply({ history, lead }) {
  if (!client) client = new Anthropic();
  const transcript = history.map((m) => `${m.dir === 'out' ? 'US' : 'CUSTOMER'}: ${m.text}`).join('\n');
  const context = [
    lead
      ? `Known lead info: name=${lead.name || '?'}, brand=${lead.brand}, area=${lead.area || '?'}, sheet status=${lead.sheetStatus || '?'}, remarks=${lead.remarks || '-'}`
      : 'New contact, not in our lead list.',
    db.settings.ai.extraInstructions ? `Extra instructions from the team: ${db.settings.ai.extraInstructions}` : '',
    '',
    'Conversation so far (oldest first):',
    transcript,
    '',
    'Write our next WhatsApp reply.',
  ]
    .filter((x) => x !== '')
    .join('\n');

  try {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the model declines, the API retries on a fallback model in the same call
      system: SYSTEM,
      output_config: { effort: 'low', format: betaZodOutputFormat(Reply) },
      messages: [{ role: 'user', content: context }],
    });
    if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
    return res.parsed_output;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) console.error('[ai] invalid ANTHROPIC_API_KEY');
    else if (e instanceof Anthropic.RateLimitError) console.error('[ai] rate limited');
    else if (e instanceof Anthropic.APIError) console.error(`[ai] API error ${e.status}: ${e.message}`);
    else console.error('[ai]', e.message);
    return null;
  }
}

module.exports = { draftReply, aiConfigured };
