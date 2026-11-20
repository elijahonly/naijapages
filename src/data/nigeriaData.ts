import { Business, GeopoliticalZone, GeopoliticalZoneCode, StateInfo, EmergencyContact } from '../types';

export const ZONES: Record<GeopoliticalZoneCode, GeopoliticalZone> = {
  SW: { code: 'SW', name: 'South West', color: '#2563eb', bgLight: '#eff6ff' },
  SS: { code: 'SS', name: 'South South', color: '#059669', bgLight: '#ecfdf5' },
  SE: { code: 'SE', name: 'South East', color: '#7c3aed', bgLight: '#f5f3ff' },
  NC: { code: 'NC', name: 'North Central', color: '#0d9488', bgLight: '#f0fdfa' },
  NW: { code: 'NW', name: 'North West', color: '#ea580c', bgLight: '#fff7ed' },
  NE: { code: 'NE', name: 'North East', color: '#d97706', bgLight: '#fffbeb' },
};

export const CATEGORIES = [
  { key: 'All', label: 'All Businesses', emoji: '🏢', count: 0 },
  { key: 'Tech', label: 'Tech & Innovation', emoji: '💻', count: 0 },
  { key: 'Food', label: 'Food & Restaurants', emoji: '🍲', count: 0 },
  { key: 'Hotels', label: 'Hotels & Lodging', emoji: '🏨', count: 0 },
  { key: 'Health', label: 'Health & Hospitals', emoji: '🏥', count: 0 },
  { key: 'Finance', label: 'Finance & Banking', emoji: '🏦', count: 0 },
  { key: 'Retail', label: 'Retail & Supermarkets', emoji: '🛍️', count: 0 },
  { key: 'Auto', label: 'Auto & Transport', emoji: '🚗', count: 0 },
  { key: 'Education', label: 'Education & Schools', emoji: '🎓', count: 0 },
  { key: 'Beauty', label: 'Beauty & Spas', emoji: '💈', count: 0 },
  { key: 'Services', label: 'Professional Services', emoji: '⚖️', count: 0 },
  { key: 'Artisans', label: 'Artisans & Repairs', emoji: '🔧', count: 0 },
];

export const STATES_DATA: StateInfo[] = [
  { name: 'Abia', capital: 'Umuahia', zone: 'SE', key: 'abia', lgas: ['Aba North', 'Aba South', 'Arochukwu', 'Bende', 'Ikwuano', 'Isiala Ngwa North', 'Isiala Ngwa South', 'Isuikwuato', 'Obingwa', 'Ohafia', 'Osisioma', 'Ugwunagbo', 'Ukwa East', 'Ukwa West', 'Umuahia North', 'Umuahia South', 'Umu Nneochi'] },
  { name: 'Adamawa', capital: 'Yola', zone: 'NE', key: 'adamawa', lgas: ['Yola North', 'Yola South', 'Mubi North', 'Mubi South', 'Jimeta', 'Girei', 'Numan', 'Michika', 'Gombi'] },
  { name: 'Akwa Ibom', capital: 'Uyo', zone: 'SS', key: 'akwa-ibom', lgas: ['Uyo', 'Ikot Ekpene', 'Eket', 'Oron', 'Abak', 'Etinan', 'Ikot Abasi', 'Ibiono-Ibom', 'Ibesikpo Asutan'] },
  { name: 'Anambra', capital: 'Awka', zone: 'SE', key: 'anambra', lgas: ['Awka South', 'Awka North', 'Onitsha North', 'Onitsha South', 'Nnewi North', 'Nnewi South', 'Aguata', 'Idemili North', 'Idemili South', 'Ihiala', 'Ogbaru', 'Oyi'] },
  { name: 'Bauchi', capital: 'Bauchi', zone: 'NE', key: 'bauchi', lgas: ['Bauchi', 'Katagum', 'Misau', 'Tafawa Balewa', 'Dass', 'Jamaare', 'Ningi', 'Alkaleri'] },
  { name: 'Bayelsa', capital: 'Yenagoa', zone: 'SS', key: 'bayelsa', lgas: ['Yenagoa', 'Brass', 'Nembe', 'Ogbia', 'Sagbama', 'Southern Ijaw', 'Ekeremor', 'Kolokuma/Opokuma'] },
  { name: 'Benue', capital: 'Makurdi', zone: 'NC', key: 'benue', lgas: ['Makurdi', 'Gboko', 'Otukpo', 'Katsina-Ala', 'Gwer East', 'Gwer West', 'Vandeikya'] },
  { name: 'Borno', capital: 'Maiduguri', zone: 'NE', key: 'borno', lgas: ['Maiduguri', 'Jere', 'Biu', 'Bama', 'Konduga', 'Askira/Uba', 'Monguno'] },
  { name: 'Cross River', capital: 'Calabar', zone: 'SS', key: 'cross-river', lgas: ['Calabar Municipal', 'Calabar South', 'Akamkpa', 'Biase', 'Ikom', 'Ogoja', 'Obudu', 'Yakurr'] },
  { name: 'Delta', capital: 'Asaba', zone: 'SS', key: 'delta', lgas: ['Oshimili South', 'Oshimili North', 'Warri South', 'Warri North', 'Uvwie', 'Sapele', 'Ughelli North', 'Ughelli South', 'Ika North East', 'Ika South'] },
  { name: 'Ebonyi', capital: 'Abakaliki', zone: 'SE', key: 'ebonyi', lgas: ['Abakaliki', 'Afikpo North', 'Afikpo South', 'Ebonyi', 'Ezza North', 'Ezza South', 'Ikwo', 'Ishielu', 'Ohaozara', 'Ohaukwu'] },
  { name: 'Edo', capital: 'Benin City', zone: 'SS', key: 'edo', lgas: ['Oredo', 'Ikpoba-Okha', 'Egor', 'Esan Central', 'Esan North-East', 'Esan West', 'Etsako West', 'Etsako Central', 'Uhunmwonde', 'Ovia North-East'] },
  { name: 'Ekiti', capital: 'Ado-Ekiti', zone: 'SW', key: 'ekiti', lgas: ['Ado-Ekiti', 'Ikere', 'Ijero', 'Oye', 'Ekiti West', 'Ekiti South-West', 'Irepodun/Ifelodun'] },
  { name: 'Enugu', capital: 'Enugu', zone: 'SE', key: 'enugu', lgas: ['Enugu North', 'Enugu South', 'Enugu East', 'Nsukka', 'Udi', 'Nkanu West', 'Nkanu East', 'Oji River', 'Ezeagu', 'Awgu'] },
  { name: 'FCT', capital: 'Abuja', zone: 'NC', key: 'fct', lgas: ['Abuja Municipal', 'Bwari', 'Gwagwalada', 'Kuje', 'Kwali', 'Abaji'] },
  { name: 'Gombe', capital: 'Gombe', zone: 'NE', key: 'gombe', lgas: ['Gombe', 'Akko', 'Yamaltu/Deba', 'Kaltungo', 'Billiri', 'Funakaye'] },
  { name: 'Imo', capital: 'Owerri', zone: 'SE', key: 'imo', lgas: ['Owerri Municipal', 'Owerri North', 'Owerri West', 'Orlu', 'Okigwe', 'Mbaitoli', 'Ikeduru', 'Ngor Okpala', 'Oguta'] },
  { name: 'Jigawa', capital: 'Dutse', zone: 'NW', key: 'jigawa', lgas: ['Dutse', 'Hadejia', 'Kazaure', 'Gumel', 'Ringim', 'Birnin Kudu'] },
  { name: 'Kaduna', capital: 'Kaduna', zone: 'NW', key: 'kaduna', lgas: ['Kaduna North', 'Kaduna South', 'Chikun', 'Zaria', 'Igabi', 'Jemaa', 'Sabon Gari', 'Giwa', 'Kagarko'] },
  { name: 'Kano', capital: 'Kano', zone: 'NW', key: 'kano', lgas: ['Kano Municipal', 'Nasarawa', 'Fagge', 'Dala', 'Gwale', 'Tarauni', 'Ungogo', 'Kumbotso', 'Gwarzo', 'Bichi', 'Dawakin Kudu', 'Wudil'] },
  { name: 'Katsina', capital: 'Katsina', zone: 'NW', key: 'katsina', lgas: ['Katsina', 'Daura', 'Funtua', 'Malumfashi', 'Kankia', 'Dutsin Ma', 'Mani', 'Bakori'] },
  { name: 'Kebbi', capital: 'Birnin Kebbi', zone: 'NW', key: 'kebbi', lgas: ['Birnin Kebbi', 'Argungu', 'Yauri', 'Zuru', 'Jega', 'Bunza'] },
  { name: 'Kogi', capital: 'Lokoja', zone: 'NC', key: 'kogi', lgas: ['Lokoja', 'Okene', 'Ajaokuta', 'Dekina', 'Idah', 'Kabba/Bunu', 'Ankpa', 'Adavi', 'Yagba West', 'Yagba East', 'Ijumu', 'Kogi (Koton Karfe)', 'Okehi', 'Ofu', 'Olamaboro', 'Omala', 'Bassa', 'Ibaji', 'Igalamela-Odolu', 'Mopa-Muro', 'Ogori/Magongo'] },
  { name: 'Kwara', capital: 'Ilorin', zone: 'NC', key: 'kwara', lgas: ['Ilorin South', 'Ilorin West', 'Ilorin East', 'Offa', 'Omu-Aran', 'Kaiama', 'Moro', 'Edu'] },
  { name: 'Lagos', capital: 'Ikeja', zone: 'SW', key: 'lagos', lgas: ['Agege', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Shomolu', 'Surulere'] },
  { name: 'Nasarawa', capital: 'Lafia', zone: 'NC', key: 'nasarawa', lgas: ['Lafia', 'Keffi', 'Akwanga', 'Karu', 'Doma', 'Nasarawa', 'Wamba'] },
  { name: 'Niger', capital: 'Minna', zone: 'NC', key: 'niger', lgas: ['Chanchaga', 'Bosso', 'Bida', 'Suleja', 'Kontagora', 'Mokwa', 'Lapai', 'Shiroro'] },
  { name: 'Ogun', capital: 'Abeokuta', zone: 'SW', key: 'ogun', lgas: ['Abeokuta South', 'Abeokuta North', 'Ado-Odo/Ota', 'Ijebu Ode', 'Sagamu', 'Ifo', 'Obafemi Owode', 'Ewekoro', 'Ijebu North'] },
  { name: 'Ondo', capital: 'Akure', zone: 'SW', key: 'ondo', lgas: ['Akure South', 'Akure North', 'Ondo West', 'Ondo East', 'Owo', 'Ikare Akoko', 'Okitipupa', 'Idanre'] },
  { name: 'Osun', capital: 'Osogbo', zone: 'SW', key: 'osun', lgas: ['Osogbo', 'Ilesa East', 'Ilesa West', 'Ife Central', 'Ife East', 'Ede North', 'Ede South', 'Iwo'] },
  { name: 'Oyo', capital: 'Ibadan', zone: 'SW', key: 'oyo', lgas: ['Ibadan North', 'Ibadan North-East', 'Ibadan North-West', 'Ibadan South-West', 'Ibadan South-East', 'Ogbomosho North', 'Ogbomosho South', 'Oyo East', 'Oyo West', 'Iseyin', 'Egbeda', 'Oluyole'] },
  { name: 'Plateau', capital: 'Jos', zone: 'NC', key: 'plateau', lgas: ['Jos North', 'Jos South', 'Jos East', 'Barkin Ladi', 'Mangu', 'Pankshin', 'Shendam', 'Bassa'] },
  { name: 'Rivers', capital: 'Port Harcourt', zone: 'SS', key: 'rivers', lgas: ['Port Harcourt', 'Obio-Akpor', 'Eleme', 'Ikwerre', 'Oyigbo', 'Bonny', 'Okrika', 'Degema', 'Ahoada East', 'Ahoada West', 'Gokana', 'Khana'] },
  { name: 'Sokoto', capital: 'Sokoto', zone: 'NW', key: 'sokoto', lgas: ['Sokoto North', 'Sokoto South', 'Wamakko', 'Tambuwal', 'Bodinga', 'Gwadabawa', 'Illela'] },
  { name: 'Taraba', capital: 'Jalingo', zone: 'NE', key: 'taraba', lgas: ['Jalingo', 'Wukari', 'Bali', 'Gashaka', 'Takum', 'Sardauna', 'Zing'] },
  { name: 'Yobe', capital: 'Damaturu', zone: 'NE', key: 'yobe', lgas: ['Damaturu', 'Potiskum', 'Gashua', 'Nguru', 'Geidam', 'Bade', 'Fika'] },
  { name: 'Zamfara', capital: 'Gusau', zone: 'NW', key: 'zamfara', lgas: ['Gusau', 'Kaura Namoda', 'Talata Mafara', 'Maru', 'Anka', 'Tsafe', 'Shinkafi'] },
];

// Directory listings are loaded from genuine member submissions stored in Cloudflare D1.
export const INITIAL_BUSINESSES: Business[] = [];

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  { service: 'National Emergency Toll-Free', number: '112', agency: 'Nigerian Communications Commission (NCC)', coverage: 'Nationwide', description: 'Central dispatch routing calls to Police, Ambulance, and Fire Service.' },
  { service: 'Lagos Emergency Management', number: '767', agency: 'LASEMA', coverage: 'Lagos State Only', description: 'Rapid response for road accidents, fire outbreaks, structural collapses.' },
  { service: 'Federal Road Safety Corps (FRSC)', number: '122', agency: 'FRSC National Command', coverage: 'All Highway Interstates', description: 'Highway emergency rescue, crash scenes, road blockage clearing.' },
  { service: 'Federal Fire Service', number: '0803 200 3557', agency: 'National Fire Headquarters', coverage: 'Nationwide / FCT', description: 'Commercial & residential fire rescue, chemical hazards control.' },
  { service: 'Nigeria Centre for Disease Control (NCDC)', number: '6232', agency: 'NCDC Toll-Free', coverage: 'Nationwide', description: 'Disease surveillance, epidemic alerts, medical outbreak guidance.' },
  { service: 'Police Control Room & Distress', number: '0803 123 0631', agency: 'Nigeria Police Force', coverage: 'Nationwide', description: 'Armed robbery, kidnapping distress lines, security emergencies.' },
];

// Helper to format clean WhatsApp URL with friendly Nigerian business greeting
export function formatWhatsAppUrl(whatsapp: string, businessName: string): string {
  let clean = whatsapp.replace(/\D/g, '');
  if (clean.startsWith('0')) {
    clean = '234' + clean.slice(1);
  } else if (!clean.startsWith('234')) {
    clean = '234' + clean;
  }
  const message = encodeURIComponent(`Hello ${businessName}, I found your listing on NaijaPages (Nigeria Business Directory). I would like to make an inquiry.`);
  return `https://wa.me/${clean}?text=${message}`;
}

// Helper to format phone for direct calling
export function formatTelUrl(phone: string): string {
  return `tel:${phone.replace(/\s+/g, '')}`;
}

// Generate Google Maps search / embed URL for a business
export function getGoogleMapsEmbedUrl(address: string, name: string, state: string): string {
  const query = encodeURIComponent(`${name}, ${address}, ${state}, Nigeria`);
  return `https://maps.google.com/maps?q=${query}&t=&z=14&ie=UTF8&iwloc=&output=embed`;
}

export function getGoogleMapsDirectionsUrl(address: string, name: string, state: string): string {
  const destination = encodeURIComponent(`${name}, ${address}, ${state}, Nigeria`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}
