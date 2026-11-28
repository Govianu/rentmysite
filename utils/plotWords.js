// The words for uploads on each site: RentMySite owners upload a "plot", PartnerMyBusiness businesses a "place".
// The same code runs on both sites; HUB_BRAND (rentmysite | pmb) picks the wording, the types and the ID prefix.
const BRAND = (process.env.HUB_BRAND || 'rentmysite').toLowerCase() === 'pmb' ? 'pmb' : 'rentmysite';

const WORDS = {
  rentmysite: {
    brand: 'rentmysite', site: 'RentMySite.ai', team: 'RentMySite', noun: 'plot', nouns: 'plots', Noun: 'Plot', Nouns: 'Plots',
    idPrefix: 'RMS-PLOT', formPath: '/list-plot', browseTitle: 'Plots & land available',
    seekers: 'businesses and brands looking for space',
    types: ['Vacant plot / land', 'Agricultural land', 'Converted (DC) land', 'Commercial site', 'Industrial plot / KIADB',
      'Terrace or rooftop', 'Godown or warehouse', 'Shed or factory', 'Building / floor', 'Shop or showroom', 'Parking area', 'Other'],
  },
  pmb: {
    brand: 'pmb', site: 'PartnerMyBusiness.ai', team: 'PartnerMyBusiness', noun: 'place', nouns: 'places', Noun: 'Place', Nouns: 'Places',
    idPrefix: 'PMB-PLACE', formPath: '/list-place', browseTitle: 'Business places available',
    seekers: 'partners and brands looking for a place to work or sell',
    types: ['Restaurant / café', 'Cloud kitchen / kitchen', 'Shop / showroom', 'Hall / event space', 'Office / co-working',
      'Hotel / guest house', 'Gym / studio / salon', 'School / training centre', 'Clinic', 'Terrace or rooftop', 'Parking / open area', 'Godown / warehouse', 'Other'],
  },
};

module.exports = { BRAND, W: WORDS[BRAND] };
