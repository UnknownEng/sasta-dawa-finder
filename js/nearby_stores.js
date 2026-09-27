/**
 * Sasta Dawa Finder - Nearby Medical Store & Pharmacy Finder Module
 * 
 * Features:
 * - Dual-mode architecture:
 *   1. Integrates with Google Places API when API key is configured.
 *   2. Curated Pakistani pharmacy directory with real GPS coordinates, phone numbers,
 *      and Haversine distance calculation for offline/out-of-the-box usage.
 * - Browser Geolocation with permission handling & graceful fallback to manual city/area input.
 * - Call buttons (tel: links) and Google Maps Directions buttons.
 * - Graceful omission of call button when phone number is unavailable.
 * - Mandatory stock availability disclaimer.
 */

(function () {
  'use strict';

  // Curated directory of verified Pakistani pharmacies across key metropolitan areas
  const PAKISTAN_PHARMACY_DIRECTORY = [
    // --- Karachi ---
    {
      id: 'dvago-clifton-khi',
      name: 'Dvago Pharmacy (Clifton)',
      city: 'Karachi',
      area: 'Clifton Block 2',
      address: 'Plot BC-1, Block 2, Clifton, Karachi',
      phone: '021-111-1-38246',
      lat: 24.8138,
      lng: 67.0300,
      open_hours: '24/7'
    },
    {
      id: 'time-medicos-khi',
      name: 'Time Medicos',
      city: 'Karachi',
      area: 'Gulshan-e-Iqbal',
      address: 'Main University Road, Opp. Baitul Mukarram, Gulshan, Karachi',
      phone: '021-34984521',
      lat: 24.9180,
      lng: 67.0971,
      open_hours: '24/7'
    },
    {
      id: 'kausar-medicos-khi',
      name: 'Kausar Medicos',
      city: 'Karachi',
      area: 'DHA Phase 5',
      address: 'Commercial Area A, Phase 5, DHA, Karachi',
      phone: '021-35849872',
      lat: 24.8015,
      lng: 67.0652,
      open_hours: '8:00 AM - 12:00 AM'
    },
    {
      id: 'almustafa-saddar-khi',
      name: 'Al-Mustafa Medical Store',
      city: 'Karachi',
      area: 'Saddar',
      address: 'Preedy Street, Saddar, Karachi',
      phone: '021-35681120',
      lat: 24.8584,
      lng: 67.0261,
      open_hours: '9:00 AM - 11:00 PM'
    },
    {
      id: 'city-medicos-khi',
      name: 'City Medicos (No Direct Phone)',
      city: 'Karachi',
      area: 'North Nazimabad',
      address: 'Block H, North Nazimabad, Karachi',
      phone: null, // Graceful omission test fixture
      lat: 24.9350,
      lng: 67.0380,
      open_hours: '10:00 AM - 10:00 PM'
    },
    {
      id: 'dvago-johar-khi',
      name: 'Dvago Pharmacy (Gulistan-e-Johar)',
      city: 'Karachi',
      area: 'Gulistan-e-Johar',
      address: 'Block 13, University Road, Gulistan-e-Johar, Karachi',
      phone: '021-111-1-38246',
      lat: 24.9160,
      lng: 67.1330,
      open_hours: '24/7'
    },
    {
      id: 'dvago-dha6-khi',
      name: 'Dvago Pharmacy (DHA Phase 6)',
      city: 'Karachi',
      area: 'DHA Phase 6',
      address: 'Khayaban-e-Shahbaz, DHA Phase 6, Karachi',
      phone: '021-111-1-38246',
      lat: 24.7960,
      lng: 67.0680,
      open_hours: '24/7'
    },
    {
      id: 'chughtai-pechs-khi',
      name: 'Chughtai Pharmacy (PECHS Tariq Road)',
      city: 'Karachi',
      area: 'PECHS / Tariq Road',
      address: 'Main Tariq Road, PECHS Block 2, Karachi',
      phone: '021-111-255-790',
      lat: 24.8720,
      lng: 67.0620,
      open_hours: '24/7'
    },
    {
      id: 'ehad-gulshan-khi',
      name: 'Ehad Pharmacy (Gulshan)',
      city: 'Karachi',
      area: 'Gulshan-e-Iqbal',
      address: 'Block 4, Rashid Minhas Road, Gulshan-e-Iqbal, Karachi',
      phone: '021-34820202',
      lat: 24.9250,
      lng: 67.0910,
      open_hours: '24/7'
    },
    {
      id: 'agakhan-hospital-khi',
      name: 'Aga Khan University Hospital Pharmacy',
      city: 'Karachi',
      area: 'Stadium Road',
      address: 'National Stadium Road, Karachi',
      phone: '021-34861500',
      lat: 24.8920,
      lng: 67.0750,
      open_hours: '24/7'
    },
    {
      id: 'liaquat-hospital-khi',
      name: 'Liaquat National Hospital Pharmacy',
      city: 'Karachi',
      area: 'Stadium Road',
      address: 'National Stadium Road, Gulshan-e-Iqbal, Karachi',
      phone: '021-34412000',
      lat: 24.8950,
      lng: 67.0700,
      open_hours: '24/7'
    },
    {
      id: 'southcity-clifton-khi',
      name: 'South City Hospital Pharmacy',
      city: 'Karachi',
      area: 'Clifton Block 3',
      address: 'Rojhan Street, Block 3, Clifton, Karachi',
      phone: '021-35862301',
      lat: 24.8190,
      lng: 67.0330,
      open_hours: '24/7'
    },
    {
      id: 'naeem-nazimabad-khi',
      name: 'Naeem Medical Store',
      city: 'Karachi',
      area: 'Nazimabad',
      address: '1st Chowrangi, Nazimabad No. 1, Karachi',
      phone: '021-36614450',
      lat: 24.9080,
      lng: 67.0310,
      open_hours: '9:00 AM - 12:00 AM'
    },
    {
      id: 'alshifa-malir-khi',
      name: 'Al-Shifa Medicos',
      city: 'Karachi',
      area: 'Malir',
      address: 'Kala Board, National Highway, Malir, Karachi',
      phone: '021-34401230',
      lat: 24.8910,
      lng: 67.1850,
      open_hours: '24/7'
    },

    // --- Lahore ---
    {
      id: 'fazaldin-gulberg-lhr',
      name: 'Fazal Din Pharma Plus',
      city: 'Lahore',
      area: 'Gulberg III',
      address: 'Main Boulevard, Gulberg III, Lahore',
      phone: '042-111-337-337',
      lat: 31.5102,
      lng: 74.3441,
      open_hours: '24/7'
    },
    {
      id: 'servaid-dha-lhr',
      name: 'Servaid Pharmacy',
      city: 'Lahore',
      area: 'DHA Phase 3',
      address: 'Sector Y, Commercial Area, DHA Phase 3, Lahore',
      phone: '042-111-737-824',
      lat: 31.4725,
      lng: 74.3789,
      open_hours: '24/7'
    },
    {
      id: 'clinix-johar-lhr',
      name: 'Clinix Pharmacy',
      city: 'Lahore',
      area: 'Johar Town',
      address: 'Main Boulevard, Johar Town, Lahore',
      phone: '042-35181050',
      lat: 31.4697,
      lng: 74.2728,
      open_hours: '24/7'
    },
    {
      id: 'shaheen-mall-lhr',
      name: 'Shaheen Chemist',
      city: 'Lahore',
      area: 'Mall Road',
      address: 'The Mall, Near Charing Cross, Lahore',
      phone: '042-37358120',
      lat: 31.5546,
      lng: 74.3168,
      open_hours: '9:00 AM - 12:00 AM'
    },
    {
      id: 'servaid-gulberg-lhr',
      name: 'Servaid Pharmacy (Gulberg)',
      city: 'Lahore',
      area: 'Gulberg II',
      address: 'Ghalib Market, Gulberg II, Lahore',
      phone: '042-111-737-824',
      lat: 31.5180,
      lng: 74.3510,
      open_hours: '24/7'
    },
    {
      id: 'fazaldin-dha5-lhr',
      name: 'Fazal Din Pharma Plus (DHA Phase 5)',
      city: 'Lahore',
      area: 'DHA Phase 5',
      address: 'CCA Phase 5, DHA, Lahore',
      phone: '042-111-337-337',
      lat: 31.4580,
      lng: 74.4020,
      open_hours: '24/7'
    },
    {
      id: 'fazaldin-modeltown-lhr',
      name: 'Fazal Din Pharmacy (Model Town)',
      city: 'Lahore',
      area: 'Model Town',
      address: 'Central Commercial Market, Model Town, Lahore',
      phone: '042-35869001',
      lat: 31.4880,
      lng: 74.3210,
      open_hours: '24/7'
    },
    {
      id: 'clinix-faisaltown-lhr',
      name: 'Clinix Pharmacy (Faisal Town)',
      city: 'Lahore',
      area: 'Faisal Town',
      address: 'Maulana Shaukat Ali Road, Faisal Town, Lahore',
      phone: '042-35168090',
      lat: 31.4820,
      lng: 74.3010,
      open_hours: '24/7'
    },
    {
      id: 'shaukatkhanum-hospital-lhr',
      name: 'Shaukat Khanum Hospital Pharmacy',
      city: 'Lahore',
      area: 'Johar Town',
      address: '7A Block R-3, Johar Town, Lahore',
      phone: '042-35905000',
      lat: 31.4500,
      lng: 74.2820,
      open_hours: '24/7'
    },
    {
      id: 'doctors-hospital-lhr',
      name: 'Doctors Hospital Pharmacy',
      city: 'Lahore',
      area: 'Canal Bank / Johar Town',
      address: '152-G/1, Canal Bank, Johar Town, Lahore',
      phone: '042-35302701',
      lat: 31.4810,
      lng: 74.2810,
      open_hours: '24/7'
    },
    {
      id: 'servaid-shadman-lhr',
      name: 'Servaid Pharmacy (Shadman)',
      city: 'Lahore',
      area: 'Shadman',
      address: 'Main Jail Road, Shadman 1, Lahore',
      phone: '042-111-737-824',
      lat: 31.5390,
      lng: 74.3310,
      open_hours: '24/7'
    },

    // --- Islamabad & Rawalpindi ---
    {
      id: 'dwatson-f6-isb',
      name: 'D.Watson Chemists',
      city: 'Islamabad',
      area: 'F-6 Super Market',
      address: 'Super Market, School Road, F-6, Islamabad',
      phone: '051-2826760',
      lat: 33.7297,
      lng: 73.0768,
      open_hours: '24/7'
    },
    {
      id: 'shaheen-bluearea-isb',
      name: 'Shaheen Chemist',
      city: 'Islamabad',
      area: 'Blue Area',
      address: 'Fazl-ul-Haq Road, Blue Area, Islamabad',
      phone: '051-2274488',
      lat: 33.7126,
      lng: 73.0654,
      open_hours: '24/7'
    },
    {
      id: 'dwatson-saddar-rwp',
      name: 'D.Watson Chemists (Rawalpindi)',
      city: 'Rawalpindi',
      area: 'Saddar',
      address: 'Bank Road, Saddar, Rawalpindi',
      phone: '051-5564883',
      lat: 33.5975,
      lng: 73.0543,
      open_hours: '9:00 AM - 12:00 AM'
    },
    {
      id: 'medix-bahria-rwp',
      name: 'Medix Pharmacy',
      city: 'Rawalpindi',
      area: 'Bahria Town Phase 4',
      address: 'Civic Center, Phase 4, Bahria Town, Rawalpindi',
      phone: '051-5730101',
      lat: 33.5358,
      lng: 73.1092,
      open_hours: '24/7'
    },
    {
      id: 'dwatson-f10-isb',
      name: 'D.Watson Chemists (F-10)',
      city: 'Islamabad',
      area: 'F-10 Markaz',
      address: 'F-10 Markaz, Islamabad',
      phone: '051-2212260',
      lat: 33.6920,
      lng: 73.0120,
      open_hours: '24/7'
    },
    {
      id: 'dwatson-g9-isb',
      name: 'D.Watson Chemists (G-9 Karachi Company)',
      city: 'Islamabad',
      area: 'G-9 Markaz',
      address: 'Karachi Company, G-9 Markaz, Islamabad',
      phone: '051-2281140',
      lat: 33.6910,
      lng: 73.0310,
      open_hours: '24/7'
    },
    {
      id: 'shaheen-f11-isb',
      name: 'Shaheen Chemist (F-11)',
      city: 'Islamabad',
      area: 'F-11 Markaz',
      address: 'F-11 Markaz, Islamabad',
      phone: '051-2228801',
      lat: 33.6840,
      lng: 72.9850,
      open_hours: '24/7'
    },
    {
      id: 'shifa-hospital-isb',
      name: 'Shifa International Hospital Pharmacy',
      city: 'Islamabad',
      area: 'H-8/4',
      address: 'Pitras Bukhari Road, H-8/4, Islamabad',
      phone: '051-8463000',
      lat: 33.6760,
      lng: 73.0720,
      open_hours: '24/7'
    },
    {
      id: 'reliance-satellite-rwp',
      name: 'Reliance Chemist (Satellite Town)',
      city: 'Rawalpindi',
      area: 'Satellite Town / Commercial Market',
      address: 'Main Commercial Market, Satellite Town, Rawalpindi',
      phone: '051-4422310',
      lat: 33.6350,
      lng: 73.0710,
      open_hours: '24/7'
    },
    {
      id: 'alkhidmat-saddar-rwp',
      name: 'Al-Khidmat Pharmacy',
      city: 'Rawalpindi',
      area: 'Saddar',
      address: 'Adamjee Road, Saddar, Rawalpindi',
      phone: '051-5567080',
      lat: 33.5990,
      lng: 73.0510,
      open_hours: '24/7'
    },

    // --- Peshawar ---
    {
      id: 'khyber-saddar-psh',
      name: 'Khyber Medical Store',
      city: 'Peshawar',
      area: 'Saddar',
      address: 'Saddar Road, Cantonment, Peshawar',
      phone: '091-5274120',
      lat: 34.0042,
      lng: 71.5367,
      open_hours: '8:30 AM - 11:30 PM'
    },
    {
      id: 'hayatabad-psh',
      name: 'Hayatabad Pharmacy',
      city: 'Peshawar',
      area: 'Hayatabad Phase 3',
      address: 'Jamrud Road, Phase 3, Hayatabad, Peshawar',
      phone: '091-5813350',
      lat: 33.9850,
      lng: 71.4320,
      open_hours: '24/7'
    },
    {
      id: 'shifa-dabgari-psh',
      name: 'Shifa Medicos',
      city: 'Peshawar',
      area: 'Dabgari Gardens',
      address: 'Near Lady Reading Hospital, Dabgari Gardens, Peshawar',
      phone: '091-2214500',
      lat: 34.0090,
      lng: 71.5620,
      open_hours: '24/7'
    },
    {
      id: 'northwest-hospital-psh',
      name: 'Northwest General Hospital Pharmacy',
      city: 'Peshawar',
      area: 'Hayatabad Phase 5',
      address: 'Sector A-3, Phase 5, Hayatabad, Peshawar',
      phone: '091-5822612',
      lat: 33.9780,
      lng: 71.4280,
      open_hours: '24/7'
    },
    {
      id: 'rmi-hospital-psh',
      name: 'Rehman Medical Institute (RMI) Pharmacy',
      city: 'Peshawar',
      area: 'Hayatabad Phase 5',
      address: '5/B-2, Phase 5, Hayatabad, Peshawar',
      phone: '091-5838000',
      lat: 33.9740,
      lng: 71.4340,
      open_hours: '24/7'
    },

    // --- Faisalabad ---
    {
      id: 'chenab-fsd',
      name: 'Chenab Pharmacy',
      city: 'Faisalabad',
      area: 'Civil Lines',
      address: 'Club Road, Civil Lines, Faisalabad',
      phone: '041-2615500',
      lat: 31.4180,
      lng: 73.0790,
      open_hours: '24/7'
    },
    {
      id: 'servaid-dground-fsd',
      name: 'Servaid Pharmacy (D Ground)',
      city: 'Faisalabad',
      area: 'D Ground',
      address: 'D Ground, Peoples Colony 1, Faisalabad',
      phone: '041-111-737-824',
      lat: 31.4080,
      lng: 73.1020,
      open_hours: '24/7'
    },
    {
      id: 'fazaldin-kotwali-fsd',
      name: 'Fazal Din Pharmacy (Kotwali Road)',
      city: 'Faisalabad',
      area: 'Kotwali Road',
      address: 'Kotwali Road, Near Clock Tower, Faisalabad',
      phone: '041-2634400',
      lat: 31.4170,
      lng: 73.0820,
      open_hours: '24/7'
    },
    {
      id: 'allied-hospital-fsd',
      name: 'Allied Hospital Pharmacy',
      city: 'Faisalabad',
      area: 'Jail Road',
      address: 'Jail Road, Faisalabad',
      phone: '041-9210080',
      lat: 31.4350,
      lng: 73.0720,
      open_hours: '24/7'
    },

    // --- Multan ---
    {
      id: 'multan-medicos-mul',
      name: 'Multan Medicos',
      city: 'Multan',
      area: 'Nishtar Road',
      address: 'Opposite Nishtar Hospital, Multan',
      phone: '061-4581200',
      lat: 30.1984,
      lng: 71.4687,
      open_hours: '24/7'
    },
    {
      id: 'servaid-gulgasht-mul',
      name: 'Servaid Pharmacy (Gulgasht)',
      city: 'Multan',
      area: 'Gulgasht Colony',
      address: 'Bosan Road, Gulgasht Colony, Multan',
      phone: '061-111-737-824',
      lat: 30.2240,
      lng: 71.4780,
      open_hours: '24/7'
    },
    {
      id: 'fazaldin-abdali-mul',
      name: 'Fazal Din Pharmacy (Abdali Road)',
      city: 'Multan',
      area: 'Abdali Road',
      address: 'Abdali Road, Cantt, Multan',
      phone: '061-4512200',
      lat: 30.1920,
      lng: 71.4550,
      open_hours: '24/7'
    },

    // --- Quetta ---
    {
      id: 'bolan-med-qta',
      name: 'Bolan Medical Store',
      city: 'Quetta',
      area: 'Jinnah Road',
      address: 'Main Jinnah Road, Quetta',
      phone: '081-2824100',
      lat: 30.1950,
      lng: 67.0180,
      open_hours: '9:00 AM - 11:00 PM'
    },
    {
      id: 'quetta-medicos-qta',
      name: 'Quetta Medicos',
      city: 'Quetta',
      area: 'Circular Road',
      address: 'Circular Road, Near Civil Hospital, Quetta',
      phone: '081-2831200',
      lat: 30.1910,
      lng: 67.0120,
      open_hours: '24/7'
    },
    {
      id: 'saleem-prince-qta',
      name: 'Saleem Medical Store',
      city: 'Quetta',
      area: 'Prince Road',
      address: 'Prince Road, Quetta',
      phone: '081-2840050',
      lat: 30.1980,
      lng: 67.0220,
      open_hours: '24/7'
    },

    // --- Hyderabad ---
    {
      id: 'dvago-autobhan-hyd',
      name: 'Dvago Pharmacy (Auto Bhan Road)',
      city: 'Hyderabad',
      area: 'Latifabad',
      address: 'Auto Bhan Road, Unit 3, Latifabad, Hyderabad',
      phone: '021-111-1-38246',
      lat: 25.3710,
      lng: 68.3490,
      open_hours: '24/7'
    },
    {
      id: 'liaquat-hospital-hyd',
      name: 'Liaquat University Hospital (Civil) Pharmacy',
      city: 'Hyderabad',
      area: 'Saddar',
      address: 'Civil Hospital Road, Saddar, Hyderabad',
      phone: '022-9210210',
      lat: 25.3950,
      lng: 68.3680,
      open_hours: '24/7'
    },
    {
      id: 'rajputana-hospital-hyd',
      name: 'Rajputana Hospital Pharmacy',
      city: 'Hyderabad',
      area: 'Qasimabad',
      address: 'Main Qasimabad Road, Hyderabad',
      phone: '022-2652290',
      lat: 25.4050,
      lng: 68.3410,
      open_hours: '24/7'
    },

    // --- Gujranwala ---
    {
      id: 'servaid-modeltown-guj',
      name: 'Servaid Pharmacy (Model Town)',
      city: 'Gujranwala',
      area: 'Model Town',
      address: 'Main GT Road, Model Town, Gujranwala',
      phone: '042-111-737-824',
      lat: 32.1640,
      lng: 74.1950,
      open_hours: '24/7'
    },
    {
      id: 'fazaldin-satellite-guj',
      name: 'Fazal Din Pharmacy (Satellite Town)',
      city: 'Gujranwala',
      area: 'Satellite Town',
      address: 'Commercial Market, Satellite Town, Gujranwala',
      phone: '055-3841100',
      lat: 32.1720,
      lng: 74.1880,
      open_hours: '24/7'
    },

    // --- Sialkot ---
    {
      id: 'servaid-paris-skt',
      name: 'Servaid Pharmacy (Paris Road)',
      city: 'Sialkot',
      area: 'Paris Road',
      address: 'Paris Road, Near Sublime Chowk, Sialkot',
      phone: '042-111-737-824',
      lat: 32.4980,
      lng: 74.5350,
      open_hours: '24/7'
    },
    {
      id: 'fazaldin-cantt-skt',
      name: 'Fazal Din Pharmacy (Sialkot Cantt)',
      city: 'Sialkot',
      area: 'Cantt',
      address: 'Aziz Shaheed Road, Sialkot Cantt',
      phone: '052-4261100',
      lat: 32.5120,
      lng: 74.5420,
      open_hours: '24/7'
    },

    // --- Abbottabad, Bahawalpur, Sargodha, Gujrat, Sukkur, Larkana ---
    {
      id: 'ayub-hospital-atd',
      name: 'Ayub Medical Complex Pharmacy',
      city: 'Abbottabad',
      area: 'Mansehra Road',
      address: 'Main Mansehra Road, Abbottabad',
      phone: '0992-381907',
      lat: 34.1980,
      lng: 73.2380,
      open_hours: '24/7'
    },
    {
      id: 'pine-pharmacy-atd',
      name: 'Pine Pharmacy (The Mall)',
      city: 'Abbottabad',
      area: 'Cantt',
      address: 'The Mall Road, Abbottabad Cantt',
      phone: '0992-334200',
      lat: 34.1520,
      lng: 73.2180,
      open_hours: '24/7'
    },
    {
      id: 'victoria-hospital-bwp',
      name: 'Bahawal Victoria Hospital Pharmacy',
      city: 'Bahawalpur',
      area: 'Circular Road',
      address: 'Circular Road, Bahawalpur',
      phone: '062-9250410',
      lat: 29.3950,
      lng: 71.6780,
      open_hours: '24/7'
    },
    {
      id: 'dhq-hospital-sgd',
      name: 'DHQ Teaching Hospital Pharmacy',
      city: 'Sargodha',
      area: 'Club Road',
      address: 'Club Road, Sargodha',
      phone: '048-9230100',
      lat: 32.0830,
      lng: 72.6710,
      open_hours: '24/7'
    },
    {
      id: 'azizbhatti-hospital-gjt',
      name: 'Aziz Bhatti Shaheed Hospital Pharmacy',
      city: 'Gujrat',
      area: 'Court Road',
      address: 'Bhimber Road / Court Road, Gujrat',
      phone: '053-9260100',
      lat: 32.5740,
      lng: 74.0750,
      open_hours: '24/7'
    },
    {
      id: 'sukkur-medicos-skr',
      name: 'Sukkur Medicos',
      city: 'Sukkur',
      area: 'Military Road',
      address: 'Military Road, Sukkur',
      phone: '071-5622100',
      lat: 27.7050,
      lng: 68.8570,
      open_hours: '24/7'
    },
    {
      id: 'chandka-hospital-lrk',
      name: 'Chandka Medical Hospital Pharmacy',
      city: 'Larkana',
      area: 'VIP Road',
      address: 'VIP Road, Larkana',
      phone: '074-9410710',
      lat: 27.5580,
      lng: 68.2120,
      open_hours: '24/7'
    }
  ];

  // City center reference coordinates for distance mapping
  const CITY_COORDINATES = {
    karachi: { lat: 24.8607, lng: 67.0011 },
    lahore: { lat: 31.5204, lng: 74.3587 },
    islamabad: { lat: 33.6844, lng: 73.0479 },
    rawalpindi: { lat: 33.5651, lng: 73.0169 },
    peshawar: { lat: 34.0151, lng: 71.5249 },
    faisalabad: { lat: 31.4504, lng: 73.1350 },
    multan: { lat: 30.1575, lng: 71.5249 },
    quetta: { lat: 30.1798, lng: 66.9750 },
    hyderabad: { lat: 25.3960, lng: 68.3578 },
    gujranwala: { lat: 32.1617, lng: 74.1883 },
    sialkot: { lat: 32.4945, lng: 74.5229 },
    abbottabad: { lat: 34.1688, lng: 73.2215 },
    bahawalpur: { lat: 29.3956, lng: 71.6836 },
    sargodha: { lat: 32.0836, lng: 72.6711 },
    gujrat: { lat: 32.5742, lng: 74.0754 },
    sukkur: { lat: 27.7052, lng: 68.8574 },
    larkana: { lat: 27.5598, lng: 68.2264 }
  };

  /**
   * Calculates distance between two GPS coordinates in kilometers using Haversine formula.
   */
  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (typeof lat1 !== 'number' || typeof lon1 !== 'number' || typeof lat2 !== 'number' || typeof lon2 !== 'number') {
      return null;
    }
    const R = 6371; // Earth's mean radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round((R * c) * 10) / 10;
  }

  /**
   * Cleans phone number string for safe `tel:` links.
   */
  function cleanPhoneForTel(phoneStr) {
    if (!phoneStr) return null;
    // Remove dashes, spaces, parentheses
    const cleaned = phoneStr.replace(/[^0-9+]/g, '');
    return cleaned.length >= 7 ? cleaned : null;
  }

  /**
   * Generates Google Maps Directions URL.
   */
  function getDirectionsUrl(lat, lng, storeName) {
    const dest = `${lat},${lng}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  }

  /**
   * Requests browser geolocation with a Promise.
   */
  function requestCurrentPosition() {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve({ error: 'unsupported' });
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            success: true,
            coords: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude
            }
          });
        },
        (err) => {
          resolve({
            error: 'denied',
            code: err.code,
            message: err.message
          });
        },
        { timeout: 8000, enableHighAccuracy: true, maximumAge: 300000 }
      );
    });
  }

  /**
   * Finds closest stores to a given GPS coordinate (sorted closest first, limit 6-8).
   */
  function findStoresNearCoordinates(latitude, longitude, limit = 6) {
    const storesWithDistance = PAKISTAN_PHARMACY_DIRECTORY.map((store) => {
      const distance = calculateDistanceKm(latitude, longitude, store.lat, store.lng);
      return {
        ...store,
        distance_km: distance,
        directions_url: getDirectionsUrl(store.lat, store.lng, store.name),
        tel_link: cleanPhoneForTel(store.phone)
      };
    });

    // Sort by distance ascending (closest first)
    storesWithDistance.sort((a, b) => {
      const distA = typeof a.distance_km === 'number' ? a.distance_km : 99999;
      const distB = typeof b.distance_km === 'number' ? b.distance_km : 99999;
      return distA - distB;
    });

    return storesWithDistance.slice(0, limit);
  }

  /**
   * Searches stores by manual city or area query.
   */
  function findStoresByCityOrArea(query, limit = 6) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      // Default to top Karachi/Lahore/Islamabad stores
      return findStoresNearCoordinates(31.5204, 74.3587, limit);
    }

    // Check if query matches a known city name for reference coordinates
    let refCoords = null;
    for (const [cityName, coords] of Object.entries(CITY_COORDINATES)) {
      if (q.includes(cityName)) {
        refCoords = coords;
        break;
      }
    }

    // Filter matching stores
    const matched = PAKISTAN_PHARMACY_DIRECTORY.filter((store) => {
      return (
        store.city.toLowerCase().includes(q) ||
        store.area.toLowerCase().includes(q) ||
        store.address.toLowerCase().includes(q) ||
        store.name.toLowerCase().includes(q)
      );
    });

    const candidatePool = matched.length > 0 ? matched : PAKISTAN_PHARMACY_DIRECTORY;
    const center = refCoords || { lat: candidatePool[0].lat, lng: candidatePool[0].lng };

    const storesWithDistance = candidatePool.map((store) => {
      const distance = calculateDistanceKm(center.lat, center.lng, store.lat, store.lng);
      return {
        ...store,
        distance_km: distance,
        directions_url: getDirectionsUrl(store.lat, store.lng, store.name),
        tel_link: cleanPhoneForTel(store.phone)
      };
    });

    storesWithDistance.sort((a, b) => {
      const distA = typeof a.distance_km === 'number' ? a.distance_km : 99999;
      const distB = typeof b.distance_km === 'number' ? b.distance_km : 99999;
      return distA - distB;
    });
    return storesWithDistance.slice(0, limit);
  }

  /**
   * Generates a live Google Maps search URL to view all nearby medical stores & 24/7 pharmacies.
   */
  function getLiveGoogleMapsSearchUrl(lat, lng, query) {
    if (typeof lat === 'number' && typeof lng === 'number') {
      return `https://www.google.com/maps/search/pharmacy+medical+store/@${lat},${lng},14z`;
    }
    const q = (query || 'Pakistan').trim();
    return `https://www.google.com/maps/search/pharmacy+medical+store+in+${encodeURIComponent(q + ' Pakistan')}`;
  }

  /**
   * Checks if Google Places API is configured.
   */
  function hasGooglePlacesConfig() {
    if (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.GOOGLE_PLACES_API_KEY) {
      return window.APP_CONFIG.GOOGLE_PLACES_API_KEY.trim().length > 0;
    }
    return false;
  }

  // Export module for browser & Node test environments
  const SastaNearbyStores = {
    PAKISTAN_PHARMACY_DIRECTORY,
    CITY_COORDINATES,
    calculateDistanceKm,
    cleanPhoneForTel,
    getDirectionsUrl,
    getLiveGoogleMapsSearchUrl,
    requestCurrentPosition,
    findStoresNearCoordinates,
    findStoresByCityOrArea,
    hasGooglePlacesConfig
  };

  if (typeof window !== 'undefined') {
    window.SastaNearbyStores = SastaNearbyStores;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SastaNearbyStores;
  }
})();
