import { createContext, useContext, useState } from 'react'
import type { StoryKind } from './story.ts'

/** True when the reader asked for everyday words instead of technical detail. */
export const SimpleContext = createContext(false)
export const useSimple = () => useContext(SimpleContext)

const KEY = 'macviz.simple'

/** The saved choice. Storage can throw (private windows, blocked site data), so a failure just means "off". */
export function useSimpleSetting() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => {
    const next = !on
    try {
      localStorage.setItem(KEY, next ? '1' : '0')
    } catch {
      // Not saved; the switch still works for this visit.
    }
    setOn(next)
  }
  return [on, toggle] as const
}

/** What the Mac is doing, in plain words. */
export const PLAIN_STORY: Record<StoryKind, { title: string; text: string }> = {
  llm: {
    title: 'AI is thinking',
    text: 'An AI model on this Mac is writing an answer. For every word it reads the whole model off the Desk Space, so how fast it writes depends on the Highway Speed between the desk and the chip.',
  },
  compile: {
    title: 'Building something big',
    text: 'The Fast Workers are all busy. Building code, exporting a video or a big install looks like this.',
  },
  video: {
    title: 'Drawing pictures',
    text: 'The graphics part of the chip does most of the work while the workers stay calm. Games, video and photo editing look like this.',
  },
  indexing: {
    title: 'Tidying up in the background',
    text: 'The Eco Workers handle small chores, like syncing and search, while the Fast Workers rest to save battery.',
  },
  idle: {
    title: 'Resting',
    text: 'Almost nothing is happening. The Fast Workers are asleep and the Eco Workers sip power.',
  },
  busy: {
    title: 'Juggling a few things',
    text: 'The Fast Workers and the Eco Workers share the work.',
  },
}
