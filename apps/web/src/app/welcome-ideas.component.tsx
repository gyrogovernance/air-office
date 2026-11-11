import { useCallback, useEffect, useMemo, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import Tilt from 'react-parallax-tilt';
import { File01Icon, Folder01Icon, GridViewIcon, Store01Icon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { IconChevronLeft, IconChevronRight } from './ui-icons.component';

type WelcomeDestination = 'programs' | 'prompts' | 'teams' | 'apps' | 'market';

const ideas = [
  { destination: 'programs', icon: Folder01Icon, eyebrow: 'Organize', title: 'Start a research program', description: 'Bring projects, notes, and conversations together around a question.', action: 'Open Programs' },
  { destination: 'prompts', icon: File01Icon, eyebrow: 'Write', title: 'Turn ideas into notes', description: 'Draft a brief, collect your thinking, or pick up where you left off.', action: 'Open Notes' },
  { destination: 'teams', icon: UserGroupIcon, eyebrow: 'Collaborate', title: 'Meet your AI team', description: 'Explore assistants and choose one to help with your work.', action: 'Explore Teams' },
  { destination: 'apps', icon: GridViewIcon, eyebrow: 'Review', title: 'Put an Action to work', description: 'Review evidence, improve a draft, or build a workflow of your own.', action: 'Explore Actions' },
  { destination: 'market', icon: Store01Icon, eyebrow: 'Discover', title: 'Find tools for the job', description: 'Browse models, knowledge, skills, and more for your workspace.', action: 'Explore Market' },
] satisfies { destination: WelcomeDestination; icon: typeof Folder01Icon; eyebrow: string; title: string; description: string; action: string }[];

/** Two copies keep Embla loop filled on wide stages so both stack sides stay present. */
const SLIDE_COPIES = 2;

function trackOffset(slideIndex: number, selectedIndex: number, totalSlides: number): number {
  let diff = slideIndex - selectedIndex;
  const half = Math.floor(totalSlides / 2);
  if (diff > half) diff -= totalSlides;
  if (diff < -half) diff += totalSlides;
  return diff;
}

function nearestSlideForIdea(ideaIndex: number, selectedIndex: number): number {
  let best = ideaIndex;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let copy = 0; copy < SLIDE_COPIES; copy += 1) {
    const slideIndex = copy * ideas.length + ideaIndex;
    const distance = Math.abs(slideIndex - selectedIndex);
    if (distance < bestDistance) {
      best = slideIndex;
      bestDistance = distance;
    }
  }
  return best;
}

export function WelcomeIdeas({ onOpen }: { onOpen: (destination: WelcomeDestination) => void }) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [viewportRef, carousel] = useEmblaCarousel({
    align: 'center',
    loop: true,
    containScroll: false,
    duration: reducedMotion ? 0 : 25,
  });
  const [selected, setSelected] = useState(ideas.length);
  const slides = useMemo(() => Array.from({ length: ideas.length * SLIDE_COPIES }, (_, index) => ({
    idea: ideas[index % ideas.length],
    index,
  })), []);
  const selectedIdea = ((selected % ideas.length) + ideas.length) % ideas.length;
  const syncSelection = useCallback(() => {
    if (carousel) setSelected(carousel.selectedScrollSnap());
  }, [carousel]);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!carousel) return;
    carousel.scrollTo(ideas.length, true);
    syncSelection();
    carousel.on('select', syncSelection);
    carousel.on('reInit', syncSelection);
    return () => { carousel.off('select', syncSelection); carousel.off('reInit', syncSelection); };
  }, [carousel, syncSelection]);

  useEffect(() => {
    if (!carousel) return;
    const viewport = carousel.rootNode();
    const shell = document.querySelector('.app-shell');
    let frame = 0;
    const reinit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const ideaIndex = ((carousel.selectedScrollSnap() % ideas.length) + ideas.length) % ideas.length;
        carousel.reInit();
        carousel.scrollTo(nearestSlideForIdea(ideaIndex, ideas.length), true);
      });
    };
    const resize = new ResizeObserver(reinit);
    resize.observe(viewport);
    const watch = shell ? new MutationObserver(reinit) : null;
    watch?.observe(shell!, { attributes: true, attributeFilter: ['class'] });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      watch?.disconnect();
    };
  }, [carousel]);

  useEffect(() => {
    if (!carousel) return;
    const viewport = carousel.rootNode();
    let accumulated = 0;
    let lastWheelTime = 0;
    const onWheel = (event: WheelEvent) => {
      const delta = event.shiftKey ? (event.deltaX || event.deltaY) : event.deltaX;
      if (!delta || (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(delta))) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelTime > 200) accumulated = 0;
      lastWheelTime = now;
      accumulated += delta;
      if (Math.abs(accumulated) < 60) return;
      if (accumulated > 0) carousel.scrollNext();
      else carousel.scrollPrev();
      accumulated = 0;
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [carousel]);

  const finePointer = !reducedMotion && typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  return <section className="welcome-ideas" aria-label="Things to try" aria-roledescription="carousel" onKeyDown={(event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); carousel?.scrollPrev(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); carousel?.scrollNext(); }
  }}>
    <h3 className="welcome-ideas-heading">SHORTCUTS</h3>
    <div className="welcome-ideas-viewport" ref={viewportRef}>
      <div className="welcome-ideas-track">{slides.map(({ idea, index }) => {
        const offset = trackOffset(index, selected, slides.length);
        const inStack = Math.abs(offset) <= 2;
        return <div className="welcome-ideas-slide" data-position={offset} data-in-stack={inStack ? 'true' : 'false'} key={`${idea.destination}-${index}`} role="group" aria-roledescription="slide" aria-label={`${(index % ideas.length) + 1} of ${ideas.length}`} aria-hidden={!inStack}>
        <Tilt className="welcome-idea-tilt" tiltEnable={finePointer && offset === 0} tiltMaxAngleX={18} tiltMaxAngleY={18} perspective={700} scale={1} transitionSpeed={250}>
        <article className="welcome-idea-card" data-position={offset} data-idea={idea.destination} onClick={() => { if (offset !== 0) carousel?.scrollTo(index); }}>
          <HugeiconsIcon className="welcome-idea-icon" icon={idea.icon} size={48} aria-hidden="true" />
          <span className="welcome-idea-eyebrow">{idea.eyebrow}</span><h4>{idea.title}</h4><p>{idea.description}</p>
          <button type="button" tabIndex={index === selected ? 0 : -1} onClick={() => onOpen(idea.destination)}>{idea.action} <span aria-hidden="true">→</span></button>
        </article></Tilt>
      </div>; })}</div>
    </div>
    <div className="welcome-ideas-controls">
      <button type="button" className="welcome-ideas-arrow" aria-label="Previous idea" onClick={() => carousel?.scrollPrev()}><IconChevronLeft /></button>
      <div className="welcome-ideas-dots" aria-label="Choose an idea">{ideas.map((idea, index) => (
        <button type="button" key={idea.destination} aria-label={`Show ${idea.title}`} aria-current={index === selectedIdea ? 'true' : undefined} onClick={() => carousel?.scrollTo(nearestSlideForIdea(index, selected))} />
      ))}</div>
      <button type="button" className="welcome-ideas-arrow" aria-label="Next idea" onClick={() => carousel?.scrollNext()}><IconChevronRight /></button>
    </div>
  </section>;
}
