# AIUpdates

AI news aggregation from leading sources in the artificial intelligence ecosystem.

## Triggers

- "AI news", "AI updates", "what's new in AI"
- "check AI", "AI changes", "new AI features"
- "Anthropic news", "OpenAI news", "AI research"
- "ai updates", "update ai", "sync ai"

## Workflow Routing

| Workflow | Trigger | File |
|----------|---------|------|
| **Update** | "AI updates", "check AI news", "what's new in AI" | `Workflows/Update.md` |

## Sources

Primary sources for AI news and updates:

### Company Blogs
| Source | URL | Focus |
|--------|-----|-------|
| Anthropic Blog | anthropic.com/news | Claude updates, safety research |
| OpenAI Blog | openai.com/blog | GPT updates, research, products |
| Google DeepMind | deepmind.google/blog | Gemini, research breakthroughs |
| Meta AI | ai.meta.com/blog | Llama, open source AI |
| Hugging Face | huggingface.co/blog | Open source models, tools |
| Mistral AI | mistral.ai/news | European AI, open weights |

### Newsletters
| Source | URL | Focus |
|--------|-----|-------|
| The Batch | deeplearning.ai/the-batch | Andrew Ng's weekly AI digest |
| Import AI | importai.net | Jack Clark's AI policy/research |
| The Algorithmic Bridge | thealgorithmicbridge.substack.com | AI analysis and commentary |
| AI Weekly | aiweekly.co | Curated AI news |

### Research & Community
| Source | URL | Focus |
|--------|-----|-------|
| arXiv AI | arxiv.org/list/cs.AI | Latest AI research papers |
| Papers With Code | paperswithcode.com | Research with implementations |
| Hacker News AI | news.ycombinator.com | Community discussion |

## Output Format

Updates are categorized into three sections:

### 1. AI News (max 12 items)
New releases, product updates, company announcements.

**Ranking criteria:**
- Major model releases (GPT-5, Claude 4, Gemini 2, etc.)
- Significant capability improvements
- API changes affecting developers
- Pricing or availability changes
- Company/team announcements

### 2. AI Research (max 12 items)
Papers, benchmarks, technical breakthroughs.

**Ranking criteria:**
- Novel architectures or approaches
- State-of-the-art results on benchmarks
- Safety and alignment research
- Efficiency improvements
- Open source model releases

### 3. AI Ideas (max 8 items)
Opinion pieces, predictions, industry analysis.

**Ranking criteria:**
- Thought-provoking perspectives
- Industry trend analysis
- Regulatory and policy developments
- Ethical considerations
- Future predictions from credible sources

## State Management

State is tracked in `State/last-check.json`:

```json
{
  "last_check": "2026-01-26T00:00:00Z",
  "items_seen": ["url1", "url2"],
  "last_items_count": 24
}
```

## Example Output

```markdown
# AI Updates - 2026-01-26

## AI News
1. **Anthropic releases Claude 3.5 Opus** - New flagship model with improved reasoning
2. **OpenAI launches GPT-4.5** - Enhanced multimodal capabilities
3. **Google DeepMind announces Gemini 2** - Native multimodal architecture

## AI Research
1. **[arXiv] Scaling Laws for Constitutional AI** - Anthropic paper on alignment
2. **[Papers With Code] New SOTA on MMLU** - 95% accuracy achieved
3. **[DeepMind] AlphaFold 3 released** - Protein-drug interaction modeling

## AI Ideas
1. **The Batch: Why 2026 is the year of AI agents** - Andrew Ng analysis
2. **Import AI: Regulation roundup** - EU AI Act implementation timeline
```

## Usage

```
User: "What's new in AI?"
→ Invokes Update workflow
→ Fetches from all sources in parallel
→ Categorizes and ranks by importance
→ Returns formatted update with max 32 items
```

## Configuration

Source list and limits configured in `sources.json`.

---

*Skill modeled after SECUpdates for consistent news aggregation pattern.*
