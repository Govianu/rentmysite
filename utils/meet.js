// Creates a Google Calendar event with a Meet link for booking onboarding.
// Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN for the RentMySite calendar account.
// Without them, returns { link: null } and the UI tells the business their manager will send a link.

const crypto = require('crypto');

const configured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);

async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}`);
  return (await res.json()).access_token;
}

async function createMeeting({ summary, description, attendees = [], start }) {
  if (!configured()) return { link: null, eventId: null };

  const begin = start ? new Date(start) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(begin.getTime() + 30 * 60 * 1000);
  const token = await accessToken();

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: begin.toISOString(), timeZone: 'Asia/Kolkata' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' },
        attendees: attendees.filter(Boolean).map(email => ({ email })),
        conferenceData: {
          createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
        }
      })
    }
  );
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}: ${await res.text()}`);
  const event = await res.json();
  return { link: event.hangoutLink || null, eventId: event.id };
}

module.exports = { createMeeting, meetConfigured: configured };
