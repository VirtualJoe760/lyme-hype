/** Article and landing-page drafts for a pulled listing. DRAFT only — publishing
 *  is a separate, deliberate step this app does not take. */

import { Button } from '../ui/Button'
import {
  ARTICLE_CATEGORIES,
  LANDING_HERO_TYPES,
  type ArticleCategory,
  type LandingHeroType,
  type TopListing
} from './form-defs'

// Mirrors the panel's own state machines — 'prefilling' is a real step:
// the CMS is asked for a draft before the user edits it.
type DraftState = 'idle' | 'prefilling' | 'working' | 'done' | 'error'

export interface DraftsProps {
  topListing: TopListing | null
  articleCategory: ArticleCategory
  setArticleCategory(value: ArticleCategory): void
  articleState: DraftState
  articleMessage: string
  articleTitle: string
  setArticleTitle(value: string): void
  articleExcerpt: string
  setArticleExcerpt(value: string): void
  articleContent: string
  setArticleContent(value: string): void
  handlePrefillArticle(): void
  handleCreateArticle(): void
  // '' is the panel's unset value, not a hero type.
  landingHeroType: LandingHeroType | ''
  setLandingHeroType(value: LandingHeroType | ''): void
  landingState: DraftState
  landingMessage: string
  landingTitle: string
  setLandingTitle(value: string): void
  landingContent: string
  setLandingContent(value: string): void
  landingYoutubeUrl: string
  setLandingYoutubeUrl(value: string): void
  landingThemeOverride: string
  setLandingThemeOverride(value: string): void
  handlePrefillLandingPage(): void
  handleCreateLandingPage(): void
}

export function ListingContentDrafts({
  topListing,
  articleCategory,
  setArticleCategory,
  articleState,
  articleMessage,
  articleTitle,
  setArticleTitle,
  articleExcerpt,
  setArticleExcerpt,
  articleContent,
  setArticleContent,
  handlePrefillArticle,
  handleCreateArticle,
  landingHeroType,
  setLandingHeroType,
  landingState,
  landingMessage,
  landingTitle,
  setLandingTitle,
  landingContent,
  setLandingContent,
  landingYoutubeUrl,
  setLandingYoutubeUrl,
  landingThemeOverride,
  setLandingThemeOverride,
  handlePrefillLandingPage,
  handleCreateLandingPage
}: DraftsProps): React.JSX.Element {
  return (
    <>
      {topListing && (
        <div className="cr-cover">
          <p className="cr-help">
            Draft a market-insight article on the agent&apos;s CMS for {topListing.address || 'this listing'}.
            DRAFT only — publishing is a separate, deliberate step this app doesn&apos;t take.
          </p>
          <div className="cr-slide-kinds">
            {ARTICLE_CATEGORIES.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant={articleCategory === c.id ? 'mini-primary' : 'mini'}
                onClick={() => setArticleCategory(c.id)}
              >
                {c.label}
              </Button>
            ))}
          </div>
          <input
            className="link-input cr-input"
            placeholder="Title (10-200 characters)"
            value={articleTitle}
            onChange={(e) => setArticleTitle(e.target.value)}
            maxLength={200}
          />
          <input
            className="link-input cr-input"
            placeholder="Excerpt (optional, up to 300 characters)"
            value={articleExcerpt}
            onChange={(e) => setArticleExcerpt(e.target.value)}
            maxLength={300}
          />
          <textarea
            className="link-input cr-input cr-textarea"
            placeholder="Content (MDX, at least 500 characters)"
            value={articleContent}
            onChange={(e) => setArticleContent(e.target.value)}
            rows={6}
          />
          <Button
            variant="mini"
            type="button"
            disabled={articleState === 'prefilling'}
            onClick={() => void handlePrefillArticle()}
          >
            {articleState === 'prefilling' ? 'Fetching facts…' : '⌕ Prefill from listing facts'}
          </Button>
          <button
            className="action-btn cr-btn"
            disabled={
              articleState === 'working' || !articleTitle.trim() || articleContent.trim().length < 500
            }
            onClick={() => void handleCreateArticle()}
          >
            {articleState === 'working'
              ? 'Saving draft…'
              : `✎ Save article draft (${articleContent.trim().length}/500 chars)`}
          </button>
          {articleMessage && <div className={`cr-msg ${articleState}`}>{articleMessage}</div>}
        </div>
      )}
      {topListing && (
        <div className="cr-cover">
          <p className="cr-help">
            Draft a lead-capture landing page on the agent&apos;s CMS for{' '}
            {topListing.address || 'this listing'}. DRAFT only — publishing is a separate,
            deliberate step this app doesn&apos;t take. Lead-form field/recipient configuration
            isn&apos;t wired here — that sub-shape isn&apos;t documented at the field level, so
            it&apos;s left for the CMS&apos;s own editor once the draft exists.
          </p>
          <input
            className="link-input cr-input"
            placeholder="Title"
            value={landingTitle}
            onChange={(e) => setLandingTitle(e.target.value)}
          />
          <textarea
            className="link-input cr-input cr-textarea"
            placeholder="Content (MDX, at least 500 characters)"
            value={landingContent}
            onChange={(e) => setLandingContent(e.target.value)}
            rows={6}
          />
          <div className="cr-slide-kinds">
            {LANDING_HERO_TYPES.map((h) => (
              <Button
                key={h.id}
                type="button"
                variant={landingHeroType === h.id ? 'mini-primary' : 'mini'}
                onClick={() => setLandingHeroType(landingHeroType === h.id ? '' : h.id)}
              >
                {h.label}
              </Button>
            ))}
          </div>
          <input
            className="link-input cr-input"
            placeholder="YouTube URL (optional)"
            value={landingYoutubeUrl}
            onChange={(e) => setLandingYoutubeUrl(e.target.value)}
          />
          <input
            className="link-input cr-input"
            placeholder="Theme override (optional)"
            value={landingThemeOverride}
            onChange={(e) => setLandingThemeOverride(e.target.value)}
          />
          <Button
            variant="mini"
            type="button"
            disabled={landingState === 'prefilling'}
            onClick={() => void handlePrefillLandingPage()}
          >
            {landingState === 'prefilling' ? 'Fetching facts…' : '⌕ Prefill from listing facts'}
          </Button>
          <button
            className="action-btn cr-btn"
            disabled={
              landingState === 'working' || !landingTitle.trim() || landingContent.trim().length < 500
            }
            onClick={() => void handleCreateLandingPage()}
          >
            {landingState === 'working'
              ? 'Saving draft…'
              : `⬈ Save landing page draft (${landingContent.trim().length}/500 chars)`}
          </button>
          {landingMessage && <div className={`cr-msg ${landingState}`}>{landingMessage}</div>}
        </div>
      )}
    </>
  )
}
