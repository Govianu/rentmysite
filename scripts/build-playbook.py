# Builds utils/playbook.json for the website from the team's Google Drive research:
#   - the "PMB Business Professional" sheets (240 business / professional types: idle asset, 5 opportunities,
#     partners, budget focus, 30-sec hook) — prospect names, phones and emails are NOT copied
#   - the type-level 30-second videos and creatives in Drive (link-shared), by Drive file id
# Each row and media file is matched to one of the website's 100 business types (utils/catalog.json).
# To refresh after the team adds rows or creatives in Drive:
#   1. Export the research sheets (PMB BUSINESS PROFESSIONALS, PMB Business Professional, Azeem.pmb) and the
#      Drive file listing of videos/images into a folder as rows.json, media_raw.json and posters_last_page.json
#      (the format these files were first built in: see the README section "Team research from Google Drive").
#   2. python -I scripts/build-playbook.py <project dir> <folder with the exports>
#   3. Commit utils/playbook.json.
import json, re, sys, collections, unicodedata

PROJECT = sys.argv[1]
HERE = sys.argv[2] if len(sys.argv) > 2 else '.'
rows = json.load(open(f'{HERE}/rows.json', encoding='utf-8'))
media = json.load(open(f'{HERE}/media_raw.json', encoding='utf-8'))
posters_last_page = json.load(open(f'{HERE}/posters_last_page.json', encoding='utf-8'))
catalog = json.load(open(f'{PROJECT}/utils/catalog.json', encoding='utf-8'))
sectors = catalog['sectors']

def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    s = re.sub(r'([a-z])([A-Z])', r'\1 \2', s)            # CamelCase -> words
    return ' ' + re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip() + ' '

# Keyword rules: first match wins, so specific ones come first. Values are catalog sector ids.
RULES = [
    # professionals (Associate Network rows and pro media)
    ('personal trainer|fitness trainer|fitness coach', 55), ('yoga instructor|yoga teacher', 56), ('physiotherapist', 57),
    ('massage therapist', 58), ('beautician|esthetician', 59), ('hair stylist|hairstylist', 60), ('makeup artist|make up artist', 61),
    ('wedding photographer|freelance photographer|photographer', 62), ('videographer', 63), ('graphic designer', 64),
    ('interior designer', 65), ('architect ', 66), ('civil engineer', 67), ('electrician', 68), ('plumber', 69), ('carpenter', 70),
    ('painter', 71), ('hvac|ac technician', 72), ('it consultant', 73), ('software developer|web developer|app developer', 74),
    ('digital marketer', 75), ('social media', 76), ('accountant|chartered accountant', 77), ('bookkeeper', 78), ('tax consultant', 79),
    ('lawyer|advocate', 80), ('company secretary', 81), ('hr consultant', 82), ('recruiter', 83), ('business consultant', 84),
    ('sales consultant', 85), ('insurance', 86), ('real estate agent|property agent', 87), ('property manager', 88),
    ('event planner|event manager', 89), ('wedding planner', 90), ('musician| dj |music teacher|singer', 91), ('artist|illustrator', 92),
    ('dance instructor|dance teacher|choreographer', 93), ('sports coach|cricket coach|swimming coach', 94), ('pet trainer|dog trainer', 95),
    ('travel consultant|travel agent', 96), ('tour guide', 97), ('translator|language trainer', 98), ('content creator|influencer', 99),
    ('virtual assistant|freelance admin', 100), ('home chef|private chef|chef ', 52), ('home baker|cake artist', 53),
    ('nutritionist|dietitian', 54), ('tutor|teacher', 51),
    # businesses
    ('surgery|day care surgery', 20), ('music academy|music school|art school', 17), ('event venue|farmhouse event|wedding venue', 15),
    ('developer|construction|site office|sample flat|builder', 35), ('event management company', 45),
    ('wear |leather|luggage|footwear|saree|ethnic', 41), ('gst', 79), ('valuer|surveyor', 67), ('interpreter', 98), ('patent|trademark', 80),
    ('cloud kitchen|central catering kitchen|catering kitchen', 44), ('microbrew|food street', 1),
    ('yoga studio|dance studio|pilates studio', 4), ('motel', 2), ('paan shop|pan shop', 9), ('bakery|patisserie|sweet shop|namkeen|sweet meat|sweet-meat', 43),
    ('cafe|coffee|waffle|dessert|juice|ice cream|chai|tea room|smoothie', 3),
    ('restaurant|dhaba|thali|biryani|military hotel|kebab|grill|pizz|bbq|buffet|shawarma|food truck|food court|mess|meals|tiffin|darshini|chaat|street food|food stall|snack kiosk|bar |lounge|pub|brew|eatery|bistro|canteen', 1),
    ('co working|coworking|workafella', 11), ('tech park|business park|office building|it park|commercial complex', 12),
    ('mall|hyper city', 8), ('supermarket|grocery|hypermarket|kirana|provision|stores |organic store', 9),
    ('petrol|fuel|hpcl|bpcl|ev charging', 10),
    ('hotel|resort|lodge|homestay|home stay|farm stay|hostel| pg |paying guest|co living|serviced apartment|guest house|glamping|bungalow|dormitory|villa', 2),
    ('gym|fitness|crossfit|boxing|zumba|pilates|martial', 4), ('spa |spas |wellness|ayurved|naturopath', 5),
    ('barber', 7), ('salon|beauty parlour|beauty parlor|nail|bridal studio', 6),
    ('cinema|multiplex|theatre|theater|single screen', 14), ('banquet|kalyana|mantapa|community hall|samudaya|marriage hall|party hall', 15),
    ('convention|exhibition', 16), ('daycare|day care|preschool|play school|montessori|creche', 19),
    ('college|university|institute|iti |polytechnic', 18), ('school|stem|robotics|coaching centre|coaching center|tuition|academy of learning', 17),
    ('dental', 22), ('diagnostic|scans|labs|pathology|imaging', 23), ('pharmacy|chemist|medical store|ayurvedics', 24),
    ('physio|rehab', 25), ('pet|veterinary|vet ', 26),
    ('hospital|ivf|fertility|multi speciality|nursing home', 20), ('clinic|ent |paediatric|pediatric|hearing|eye care|skin', 21),
    ('car wash|garage|service centre|service center|hyundai service|tyre|auto repair|two wheeler service|bike service', 27),
    ('dealership|car showroom|bike showroom|automobile showroom', 28), ('car rental|bike rental|self drive|cab rental|travels|tours travels', 29),
    ('taxi|cab fleet|auto rickshaw', 30), ('courier|logistics|transport|packers|movers', 31), ('warehouse|godown', 32),
    ('cold storage|cold chain', 33), ('factory|manufactur|industrial|printing|digital prints|press |workshop unit|fabrication|farm |dairy|mill |nursery|plantation|pickle', 34),
    ('developer|construction|site office|sample flat|builder', 35), ('brokerage|real estate office|property consultants', 36),
    ('property management|facility management', 37), ('architecture|interior design studio', 38),
    ('furniture|wood worx|woodwork|lighting|home decor', 39), ('electronics|mobile store|appliance', 40),
    ('boutique|clothing|silks|saree|couture|fashion|tailor|textile|apparel|garment', 41), ('jewel', 42),
    ('event planning|wedding firm|event company', 45), ('photo studio|photography studio|video studio|recording studio', 46),
    ('golf', 48), ('sports|academy|cricket|fencing|table tennis|basketball|volleyball|badminton|skating|swimming|turf|arena|football|tennis|court', 47),
    ('laundry|dry clean|ironing', 49), ('law firm|legal', 50), ('parking', 12), ('apartment|residential|gated|rwa|society|whitehall', 13),
    ('temple|church|mosque|religious', 15), ('library|bookstore|book store', 41),
]
# Sheet "Category" fallbacks when no keyword hits
CATEGORY_FALLBACK = {
    'Restaurants & Food': 1, 'Hospitality': 2, 'Fitness & Wellness': 4, 'Retail': 9, 'Spaces': 12,
    'Healthcare': 21, 'Education': 17, 'Entertainment': 14, 'Industrial & Agri': 34, 'Automotive': 27,
    'Sports & Fitness': 94, 'Education & Coaching': 51, 'Events': 89, 'Pet Care': 95,
}
# Each keyword matches at the start of a word; a trailing space in a keyword also pins its end (e.g. 'spa ' not 'spare')
COMPILED = [(re.compile('|'.join(re.escape(' ' + k.lstrip()) for k in kw.split('|'))), sid) for kw, sid in RULES]

def match(text, category=None, pro=None):
    t = norm(text)
    for rx, sid in COMPILED:
        if rx.search(t):
            s = next(x for x in sectors if x['id'] == sid)
            if pro is None or (s['t'] == 'p') == pro:
                return sid
    return CATEGORY_FALLBACK.get(category)

# ---------- 1. Sheet rows -> sectors ----------
by_sector = collections.defaultdict(lambda: {'types': [], 'videos': [], 'images': []})
unmatched_rows = []
seen_types = set()
for r in rows:
    name = r['Business / Professional'].replace('(e.g. Magic Masala type)', '').strip()
    pro = r['Network'] == 'Associate Network'
    sid = match(name, r['Category'], pro)
    if not sid:
        unmatched_rows.append(name); continue
    key = (sid, name.lower())
    if key in seen_types: continue
    seen_types.add(key)
    by_sector[sid]['types'].append({
        'name': name, 'category': r['Category'], 'chain': 'chain' in r['Ownership type'].lower(),
        'idle': r['What sits idle today'], 'opportunities': [r[f'Opportunity {i}'] for i in range(1, 6) if r[f'Opportunity {i}']],
        'partners': r['Partners to bring in'], 'hook': r['30-sec video hook'], 'budgetFocus': r['Budget optimisation focus']
    })

# ---------- 2. Media -> sectors ----------
files = media['files'] + posters_last_page
opp_to_row = {}
for r in rows:
    for i in range(1, 6):
        o = r.get(f'Opportunity {i}', '')
        if o: opp_to_row.setdefault(norm(o), r)
skipped = collections.Counter()
folder_type = {}
def type_text(f):
    t = f['title']
    if 'Mudassar' in t: return None, 'prospect video'             # named prospect: not reused for others
    if re.match(r'Creative \d - (Brand Announcement|Earning Opportunities|Partner With Us)', t): return None, 'brand creative'
    if re.match(r'^(Reel - |PlexLive|[0-9a-f]{8}-)', t): return None, 'prospect reel'
    m = re.match(r'^PMB\.[^.]+\.(.+?)\.\d{3}', t)                   # PMB.<area>.<type>.NNN ...
    if m: return m.group(1), None
    m = re.match(r'^Poster(?:_\d+_| \d+ - | - )(.+?)\.png$', t)
    if m: return m.group(1).replace('_', ' '), None
    m = re.match(r'^\d{3}_Creative_\d+_(.+)\.png$', t)             # 001_Creative_05_<opportunity>
    if m:
        r = opp_to_row.get(norm(m.group(1).replace('_', ' ')))
        return (r['Business / Professional'] if r else m.group(1).replace('_', ' ')), None
    m = re.match(r'^Creative \d - (.+)\.png$', t)                   # type comes from the folder's video
    if m: return None, 'folder'
    return t, None
# first pass: folders whose video/poster names the type
for f in files:
    tt, why = type_text(f)
    if tt and why is None and f['parent'] not in folder_type:
        folder_type[f['parent']] = tt
for f in files:
    tt, why = type_text(f)
    if why == 'folder':
        tt = folder_type.get(f['parent'])
        if not tt:
            r = None
            mm = re.match(r'^Creative \d - (.+)\.png$', f['title'])
            if mm: r = opp_to_row.get(norm(mm.group(1)))
            tt = r['Business / Professional'] if r else None
    if not tt:
        skipped[why or 'no type'] += 1; continue
    sid = match(tt)
    if not sid:
        skipped['no sector: ' + tt[:40]] += 1; continue
    kind = 'videos' if f['mime'].startswith('video') else 'images'
    caption = re.sub(r'\.(png|mp4|jpg)$', '', f['title'])
    caption = re.sub(r'^.*?Creative[ _]?\d+[ _-]+', '', caption).replace('_', ' ').strip(' -')
    by_sector[sid][kind].append({'id': f['id'], 'title': caption, 'type': re.sub(r'\s+', ' ', norm(tt)).strip()})

# de-duplicate media ids, cap per sector
out = {}
for s in sectors:
    d = by_sector.get(s['id'])
    if not d: continue
    for k in ('videos', 'images'):
        seen = set(); d[k] = [m for m in d[k] if not (m['id'] in seen or seen.add(m['id']))][: 12 if k == 'videos' else 40]
    out[str(s['id'])] = d

json.dump({'source': 'Google Drive: Business.network.revenue (team research sheets and creatives)', 'sectors': out},
          open(f'{PROJECT}/utils/playbook.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
covered = [s for s in sectors if str(s['id']) in out]
print('sectors with data:', len(covered), '/ 100')
print('with types:', sum(1 for v in out.values() if v['types']), ' with videos:', sum(1 for v in out.values() if v['videos']), ' with images:', sum(1 for v in out.values() if v['images']))
print('rows unmatched:', unmatched_rows[:20])
print('media skipped:', skipped.most_common(15))
print('no data for:', [s['n'] for s in sectors if str(s['id']) not in out])
