import type { ToolConnection } from '@office/contracts/tool';

/**
 * The cyanheads mega pack: one publisher's fleet of public-data MCP servers,
 * hosted and keyless. Every entry is a Streamable HTTP endpoint at
 * `https://<server>.caseyjhand.com/mcp` that answers without credentials, so
 * the pack is a catalogue of addresses rather than a registry search. The
 * upstream data source is named so a reader knows what the server actually
 * reads before adding it.
 */

export type MegaPackGroup = 'News & research' | 'Science & health' | 'Government & money' | 'Reference & culture' | 'Security & infrastructure';

export type MegaPackServer = {
  /** Host label; the endpoint is derived from it. */
  id: string;
  name: string;
  description: string;
  group: MegaPackGroup;
  /** The public dataset the server reads. */
  source: string;
};

export const MEGA_PACK_GROUPS: readonly MegaPackGroup[] = ['News & research', 'Science & health', 'Government & money', 'Reference & culture', 'Security & infrastructure'];

export const MEGA_PACK_SERVERS: readonly MegaPackServer[] = [
  { id: 'hn', name: 'Hacker News', description: 'Front-page stories, comment threads and user profiles.', group: 'News & research', source: 'Hacker News' },
  { id: 'arxiv', name: 'arXiv', description: 'Search preprints and read abstracts across every category.', group: 'News & research', source: 'arXiv' },
  { id: 'pubmed', name: 'PubMed', description: 'Search biomedical literature and article records.', group: 'News & research', source: 'NCBI PubMed' },
  { id: 'secedgar', name: 'SEC EDGAR', description: 'Search company filings and read a filing’s documents.', group: 'News & research', source: 'SEC EDGAR' },
  { id: 'wikipedia', name: 'Wikipedia', description: 'Look up articles, summaries and page metadata.', group: 'News & research', source: 'Wikipedia' },
  { id: 'gdelt', name: 'GDELT', description: 'Track global news coverage and event data.', group: 'News & research', source: 'GDELT Project' },
  { id: 'bluesky', name: 'Bluesky', description: 'Read public posts, profiles and search results.', group: 'News & research', source: 'Bluesky AT Protocol' },
  { id: 'openalex', name: 'OpenAlex', description: 'Search scholarly works, authors and institutions.', group: 'News & research', source: 'OpenAlex' },
  { id: 'crossref', name: 'Crossref', description: 'Resolve DOIs and look up publication metadata.', group: 'News & research', source: 'Crossref' },
  { id: 'biorxiv', name: 'bioRxiv', description: 'Browse life-science preprints and their details.', group: 'News & research', source: 'bioRxiv' },
  { id: 'zenodo', name: 'Zenodo', description: 'Find research datasets, software and records.', group: 'News & research', source: 'Zenodo' },
  { id: 'datacite', name: 'DataCite', description: 'Resolve dataset DOIs and citation metadata.', group: 'News & research', source: 'DataCite' },
  { id: 'orcid', name: 'ORCID', description: 'Look up researcher identifiers and affiliations.', group: 'News & research', source: 'ORCID' },
  { id: 'stackexchange', name: 'Stack Exchange', description: 'Search questions and answers across the network.', group: 'News & research', source: 'Stack Exchange' },

  { id: 'openfda', name: 'openFDA', description: 'Search drug, device and adverse-event records.', group: 'Science & health', source: 'openFDA' },
  { id: 'clinicaltrials', name: 'ClinicalTrials.gov', description: 'Find trials, sponsors and study status.', group: 'Science & health', source: 'ClinicalTrials.gov' },
  { id: 'cdc', name: 'CDC', description: 'Read public-health data and surveillance figures.', group: 'Science & health', source: 'CDC' },
  { id: 'who-gho', name: 'WHO Global Health Observatory', description: 'Query global health indicators by country.', group: 'Science & health', source: 'WHO GHO' },
  { id: 'pubchem', name: 'PubChem', description: 'Look up compounds, properties and safety data.', group: 'Science & health', source: 'PubChem' },
  { id: 'chembl', name: 'ChEMBL', description: 'Search bioactivity data and drug-like molecules.', group: 'Science & health', source: 'ChEMBL' },
  { id: 'uniprot', name: 'UniProt', description: 'Look up protein records and annotations.', group: 'Science & health', source: 'UniProt' },
  { id: 'ensembl', name: 'Ensembl', description: 'Resolve genes, transcripts and genomic regions.', group: 'Science & health', source: 'Ensembl' },
  { id: 'interpro', name: 'InterPro', description: 'Classify protein families and domains.', group: 'Science & health', source: 'InterPro' },
  { id: 'gnomad-genetics', name: 'gnomAD', description: 'Check population allele frequencies.', group: 'Science & health', source: 'gnomAD' },
  { id: 'medical-codes', name: 'Medical Codes', description: 'Resolve ICD and procedure code descriptions.', group: 'Science & health', source: 'Public code sets' },
  { id: 'pharmacogenomics-guidelines', name: 'PharmGKB Guidelines', description: 'Read pharmacogenomic dosing guidance.', group: 'Science & health', source: 'PharmGKB' },
  { id: 'npi-providers', name: 'NPI Registry', description: 'Look up US healthcare provider identifiers.', group: 'Science & health', source: 'CMS NPPES' },
  { id: 'gbif-biodiversity', name: 'GBIF', description: 'Find species occurrence records worldwide.', group: 'Science & health', source: 'GBIF' },
  { id: 'inaturalist', name: 'iNaturalist', description: 'Search observations and species identifications.', group: 'Science & health', source: 'iNaturalist' },
  { id: 'worms-marine-taxa', name: 'WoRMS', description: 'Resolve marine species names and taxonomy.', group: 'Science & health', source: 'WoRMS' },
  { id: 'paleobiology', name: 'Paleobiology Database', description: 'Look up fossil occurrences and taxa.', group: 'Science & health', source: 'PBDB' },
  { id: 'protein', name: 'Protein Data Bank', description: 'Find structures and experimental entries.', group: 'Science & health', source: 'RCSB PDB' },
  { id: 'usda', name: 'USDA FoodData', description: 'Look up foods and their nutrient values.', group: 'Science & health', source: 'USDA FoodData Central' },
  { id: 'openfoodfacts', name: 'Open Food Facts', description: 'Read packaged-food ingredients and nutrition.', group: 'Science & health', source: 'Open Food Facts' },

  { id: 'congressgov', name: 'Congress.gov', description: 'Search bills, members and legislative actions.', group: 'Government & money', source: 'Congress.gov' },
  { id: 'federal-regulations', name: 'Federal Register', description: 'Read rules, notices and public comments.', group: 'Government & money', source: 'Federal Register' },
  { id: 'openfec', name: 'OpenFEC', description: 'Follow campaign finance filings and spending.', group: 'Government & money', source: 'FEC' },
  { id: 'usaspending', name: 'USAspending', description: 'Trace federal awards, contracts and grants.', group: 'Government & money', source: 'USAspending' },
  { id: 'grantsgov', name: 'Grants.gov', description: 'Find open funding opportunities.', group: 'Government & money', source: 'Grants.gov' },
  { id: 'courtlistener', name: 'CourtListener', description: 'Search opinions, dockets and citations.', group: 'Government & money', source: 'CourtListener' },
  { id: 'eur-lex', name: 'EUR-Lex', description: 'Read European Union law and treaties.', group: 'Government & money', source: 'EUR-Lex' },
  { id: 'uk-legislation', name: 'UK Legislation', description: 'Read UK acts and statutory instruments.', group: 'Government & money', source: 'legislation.gov.uk' },
  { id: 'canada-parliament', name: 'Parliament of Canada', description: 'Search bills, debates and members.', group: 'Government & money', source: 'Parliament of Canada' },
  { id: 'openstates', name: 'Open States', description: 'Follow US state legislators and bills.', group: 'Government & money', source: 'Open States' },
  { id: 'sanctions-screening', name: 'Sanctions Screening', description: 'Check names against public sanctions lists.', group: 'Government & money', source: 'Public sanctions lists' },
  { id: 'worldbank', name: 'World Bank', description: 'Query development indicators by country.', group: 'Government & money', source: 'World Bank Open Data' },
  { id: 'imf', name: 'IMF', description: 'Read macroeconomic and financial indicators.', group: 'Government & money', source: 'IMF Data' },
  { id: 'oecd', name: 'OECD', description: 'Compare economic and social statistics.', group: 'Government & money', source: 'OECD Data' },
  { id: 'eurostat', name: 'Eurostat', description: 'Query European statistical series.', group: 'Government & money', source: 'Eurostat' },
  { id: 'faostat', name: 'FAOSTAT', description: 'Read food and agriculture statistics.', group: 'Government & money', source: 'FAOSTAT' },
  { id: 'ilostat', name: 'ILOSTAT', description: 'Look up labour-market indicators.', group: 'Government & money', source: 'ILOSTAT' },
  { id: 'un-comtrade', name: 'UN Comtrade', description: 'Inspect international trade flows.', group: 'Government & money', source: 'UN Comtrade' },
  { id: 'bls-labor', name: 'BLS', description: 'Read US employment and price statistics.', group: 'Government & money', source: 'Bureau of Labor Statistics' },
  { id: 'census', name: 'US Census', description: 'Query population and economic tables.', group: 'Government & money', source: 'US Census Bureau' },
  { id: 'eia-energy', name: 'EIA', description: 'Read energy production and price data.', group: 'Government & money', source: 'US EIA' },
  { id: 'treasury-fiscaldata', name: 'Treasury Fiscal Data', description: 'Inspect federal revenue, debt and spending.', group: 'Government & money', source: 'US Treasury' },
  { id: 'exchange-rates', name: 'Exchange Rates', description: 'Convert currencies with daily reference rates.', group: 'Government & money', source: 'Frankfurter' },
  { id: 'fdic-banks', name: 'FDIC BankFind', description: 'Look up US bank institutions and financials.', group: 'Government & money', source: 'FDIC' },
  { id: 'nonprofit-explorer', name: 'Nonprofit Explorer', description: 'Read nonprofit filings and revenue.', group: 'Government & money', source: 'ProPublica' },
  { id: 'college-scorecard', name: 'College Scorecard', description: 'Compare US colleges by cost and outcomes.', group: 'Government & money', source: 'US Department of Education' },
  { id: 'socrata', name: 'Socrata', description: 'Query open-data portals that run on Socrata.', group: 'Government & money', source: 'Socrata portals' },
  { id: 'uk-police-crime', name: 'UK Police Data', description: 'Read recorded crime by area and month.', group: 'Government & money', source: 'data.police.uk' },
  { id: 'fbi-crime', name: 'FBI Crime Data', description: 'Look up reported crime statistics.', group: 'Government & money', source: 'FBI CDE' },
  { id: 'cpsc-recalls', name: 'CPSC Recalls', description: 'Search consumer product recalls.', group: 'Government & money', source: 'US CPSC' },
  { id: 'reliefweb', name: 'ReliefWeb', description: 'Read humanitarian reports and appeals.', group: 'Government & money', source: 'ReliefWeb' },
  { id: 'unhcr-refugees', name: 'UNHCR', description: 'Query refugee and displacement statistics.', group: 'Government & money', source: 'UNHCR' },

  { id: 'openlibrary', name: 'Open Library', description: 'Find books, editions and authors.', group: 'Reference & culture', source: 'Open Library' },
  { id: 'gutenberg', name: 'Project Gutenberg', description: 'Read public-domain books and metadata.', group: 'Reference & culture', source: 'Project Gutenberg' },
  { id: 'internet-archive', name: 'Internet Archive', description: 'Search archived items and collections.', group: 'Reference & culture', source: 'Internet Archive' },
  { id: 'libofcongress', name: 'Library of Congress', description: 'Search the library’s catalog and collections.', group: 'Reference & culture', source: 'Library of Congress' },
  { id: 'smithsonian', name: 'Smithsonian', description: 'Explore museum objects and records.', group: 'Reference & culture', source: 'Smithsonian Open Access' },
  { id: 'met-museum', name: 'The Met', description: 'Browse the museum’s open-access collection.', group: 'Reference & culture', source: 'Metropolitan Museum of Art' },
  { id: 'art-institute-chicago', name: 'Art Institute of Chicago', description: 'Search artworks and artist records.', group: 'Reference & culture', source: 'Art Institute of Chicago' },
  { id: 'unesco-heritage', name: 'UNESCO Heritage', description: 'Look up World Heritage sites.', group: 'Reference & culture', source: 'UNESCO' },
  { id: 'wikidata', name: 'Wikidata', description: 'Query structured facts and entity links.', group: 'Reference & culture', source: 'Wikidata' },
  { id: 'geonames', name: 'GeoNames', description: 'Resolve place names and coordinates.', group: 'Reference & culture', source: 'GeoNames' },
  { id: 'openstreetmap', name: 'OpenStreetMap', description: 'Geocode addresses and find nearby places.', group: 'Reference & culture', source: 'OpenStreetMap' },
  { id: 'elevation', name: 'Elevation', description: 'Read terrain elevation for a coordinate.', group: 'Reference & culture', source: 'Open-Elevation' },
  { id: 'national-parks', name: 'National Parks', description: 'Find parks, alerts and visitor details.', group: 'Reference & culture', source: 'US National Park Service' },
  { id: 'tvmaze', name: 'TVmaze', description: 'Look up shows, episodes and schedules.', group: 'Reference & culture', source: 'TVmaze' },
  { id: 'musicbrainz', name: 'MusicBrainz', description: 'Resolve artists, releases and recordings.', group: 'Reference & culture', source: 'MusicBrainz' },
  { id: 'pokeapi', name: 'PokéAPI', description: 'Look up creatures, moves and types.', group: 'Reference & culture', source: 'PokéAPI' },
  { id: 'oeis', name: 'OEIS', description: 'Identify integer sequences and their notes.', group: 'Reference & culture', source: 'OEIS' },
  { id: 'iana-registries', name: 'IANA Registries', description: 'Read protocol registries and assignments.', group: 'Reference & culture', source: 'IANA' },
  { id: 'reference-data', name: 'Reference Data', description: 'Convert units, currencies and country codes.', group: 'Reference & culture', source: 'Public reference sets' },
  { id: 'calculator', name: 'Calculator', description: 'Evaluate arithmetic and unit expressions.', group: 'Reference & culture', source: 'Local computation' },
  { id: 'toolkit', name: 'Toolkit', description: 'Run small text, date and encoding helpers.', group: 'Reference & culture', source: 'Local computation' },
  { id: 'cern-inspire', name: 'INSPIRE-HEP', description: 'Search particle-physics literature.', group: 'Reference & culture', source: 'CERN INSPIRE' },
  { id: 'cern-opendata', name: 'CERN Open Data', description: 'Find public particle-physics datasets.', group: 'Reference & culture', source: 'CERN Open Data' },
  { id: 'brapi', name: 'BrAPI', description: 'Query plant breeding and trial data.', group: 'Reference & culture', source: 'BrAPI' },

  { id: 'nws', name: 'National Weather Service', description: 'Read forecasts, alerts and zone conditions.', group: 'Security & infrastructure', source: 'US NWS' },
  { id: 'open-meteo', name: 'Open-Meteo', description: 'Fetch forecasts and historical weather.', group: 'Security & infrastructure', source: 'Open-Meteo' },
  { id: 'aviation-weather', name: 'Aviation Weather', description: 'Read METARs, TAFs and advisories.', group: 'Security & infrastructure', source: 'NOAA Aviation Weather' },
  { id: 'noaa-climate', name: 'NOAA Climate', description: 'Query climate observations and normals.', group: 'Security & infrastructure', source: 'NOAA NCEI' },
  { id: 'noaa-marine', name: 'NOAA Marine', description: 'Read marine forecasts and buoy data.', group: 'Security & infrastructure', source: 'NOAA NDBC' },
  { id: 'noaa-spaceweather', name: 'NOAA Space Weather', description: 'Track solar activity and geomagnetic storms.', group: 'Security & infrastructure', source: 'NOAA SWPC' },
  { id: 'usgs-water', name: 'USGS Water', description: 'Read streamflow and gauge readings.', group: 'Security & infrastructure', source: 'USGS NWIS' },
  { id: 'us-drought-monitor', name: 'US Drought Monitor', description: 'Check drought conditions by region.', group: 'Security & infrastructure', source: 'US Drought Monitor' },
  { id: 'earthquake', name: 'USGS Earthquakes', description: 'List recent seismic events and magnitudes.', group: 'Security & infrastructure', source: 'USGS' },
  { id: 'epa', name: 'EPA', description: 'Look up environmental compliance and air data.', group: 'Security & infrastructure', source: 'US EPA' },
  { id: 'nasa-power', name: 'NASA POWER', description: 'Read solar and meteorological parameters.', group: 'Security & infrastructure', source: 'NASA POWER' },
  { id: 'fema', name: 'FEMA', description: 'Search disaster declarations and aid.', group: 'Security & infrastructure', source: 'FEMA' },
  { id: 'faa-traffic-delays', name: 'FAA Delays', description: 'Check airport delays and ground stops.', group: 'Security & infrastructure', source: 'FAA' },
  { id: 'faa-aircraft-registry', name: 'FAA Aircraft Registry', description: 'Look up registered aircraft.', group: 'Security & infrastructure', source: 'FAA' },
  { id: 'faa-airmen-registry', name: 'FAA Airmen Registry', description: 'Look up pilot certificates.', group: 'Security & infrastructure', source: 'FAA' },
  { id: 'ourairports', name: 'OurAirports', description: 'Find airports, runways and frequencies.', group: 'Security & infrastructure', source: 'OurAirports' },
  { id: 'onebusaway', name: 'OneBusAway', description: 'Read transit arrivals and stops.', group: 'Security & infrastructure', source: 'OneBusAway' },
  { id: 'wsdot', name: 'WSDOT', description: 'Check Washington road and ferry conditions.', group: 'Security & infrastructure', source: 'WSDOT' },
  { id: 'openchargemap', name: 'Open Charge Map', description: 'Find electric-vehicle charging points.', group: 'Security & infrastructure', source: 'Open Charge Map' },
  { id: 'ioda-outages', name: 'IODA Outages', description: 'Check internet disruption signals.', group: 'Security & infrastructure', source: 'IODA' },
  { id: 'devops-status', name: 'DevOps Status', description: 'Read status pages for major services.', group: 'Security & infrastructure', source: 'Public status pages' },
  { id: 'nist-nvd', name: 'NIST NVD', description: 'Look up CVEs and their severity scores.', group: 'Security & infrastructure', source: 'NIST NVD' },
  { id: 'osv-advisory', name: 'OSV', description: 'Check open-source package vulnerabilities.', group: 'Security & infrastructure', source: 'OSV' },
  { id: 'mitre-cwe', name: 'MITRE CWE', description: 'Read weakness definitions and examples.', group: 'Security & infrastructure', source: 'MITRE CWE' },
  { id: 'first-epss', name: 'EPSS', description: 'Read exploit-prediction scores for CVEs.', group: 'Security & infrastructure', source: 'FIRST EPSS' },
  { id: 'cisa-cybersecurity', name: 'CISA', description: 'Read known exploited vulnerabilities and advisories.', group: 'Security & infrastructure', source: 'CISA' },
  { id: 'browser-compat', name: 'Browser Compat', description: 'Check feature support across browsers.', group: 'Security & infrastructure', source: 'MDN' },
  { id: 'pentest', name: 'Pentest Reference', description: 'Look up testing techniques and payload notes.', group: 'Security & infrastructure', source: 'Public references' },
  { id: 'fcc-spectrum', name: 'FCC Spectrum', description: 'Search licensed spectrum and antenna data.', group: 'Security & infrastructure', source: 'FCC' },
  { id: 'fcc-broadband', name: 'FCC Broadband', description: 'Read broadband availability by area.', group: 'Security & infrastructure', source: 'FCC' },
  { id: 'nhtsa', name: 'NHTSA', description: 'Search vehicle recalls and safety ratings.', group: 'Security & infrastructure', source: 'NHTSA' },
  { id: 'astronomy', name: 'Astronomy', description: 'Resolve sky objects and observing conditions.', group: 'Security & infrastructure', source: 'Public astronomy services' },
];

/** The hosted endpoint for a pack server. */
export const megaPackEndpoint = (server: MegaPackServer): string => `https://${server.id}.caseyjhand.com/mcp`;

/** The connection id a pack server is stored under, so a second add is a no-op. */
export const megaPackConnectionId = (server: MegaPackServer): string => `mega-pack-${server.id}`;

/** True when this server is already in the reader's connections. */
export function megaPackInstalled(server: MegaPackServer, connections: readonly ToolConnection[]): ToolConnection | undefined {
  const endpoint = megaPackEndpoint(server);
  return connections.find((connection) => connection.id === megaPackConnectionId(server) || connection.endpoint === endpoint);
}