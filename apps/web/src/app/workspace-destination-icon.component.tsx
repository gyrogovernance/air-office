import { publicAsset } from '../static-demo/public-asset';

export type WorkspaceDestination = 'programs' | 'teams' | 'prompts' | 'glossary' | 'search' | 'media' | 'arcade' | 'code' | 'library' | 'fellowship' | 'craft' | 'calendar' | 'notes' | 'settings' | 'market';

const iconPaths: Record<WorkspaceDestination, string> = {
  programs: 'icons/fluent/ic_fluent_molecule_48_color.svg',
  arcade: 'icons/fluent/video-game-3d.png',
  code: 'icons/fluent/ic_fluent_code_block_48_color.svg',
  library: 'icons/fluent/ic_fluent_library_32_color.svg',
  teams: 'icons/fluent/ic_fluent_people_interwoven_48_color.svg',
  prompts: 'icons/fluent/ic_fluent_clipboard_text_edit_48_color.svg',
  notes: 'icons/fluent/ic_fluent_clipboard_text_edit_48_color.svg',
  market: 'icons/fluent/ic_fluent_building_store_48_color.svg',
  glossary: 'icons/fluent/ic_fluent_book_open_lightbulb_32_color.svg',
  search: 'icons/fluent/ic_fluent_search_sparkle_48_color.svg',
  media: 'icons/fluent/ic_fluent_image_48_color.svg',
  fellowship: 'icons/fluent/ic_fluent_building_government_48_color.svg',
  craft: 'icons/fluent/ic_fluent_diversity_48_color.svg',
  calendar: 'icons/fluent/ic_fluent_calendar_48_color.svg',
  settings: 'icons/fluent/ic_fluent_settings_48_color.svg',
};

export function WorkspaceDestinationIcon({ name, size, className }: { name: WorkspaceDestination; size: number; className?: string }) {
  if (name === 'arcade') {
    return <span className={className} aria-hidden="true" style={{ fontSize: size }}>🕹️</span>;
  }
  return <img className={className} src={publicAsset(iconPaths[name])} alt="" aria-hidden="true" width={size} height={size}/>;
}
