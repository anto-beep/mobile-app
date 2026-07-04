// toolCopy.ts — Verbatim marketing copy for each of the 8 Wayly AI tools,
// mirrored from https://aged-care-os.emergent.host/ai-tools/{slug}.
//
// The mobile app uses this data to render the "About this tool" info sheet
// so the in-app experience matches the web pages (What This Tool Does,
// How It Works, What You'll Need / Get, Common Questions, disclaimer).
//
// Keep in sync with the web pages when they change. Copy is intentionally
// unabbreviated so nothing is lost between the two platforms.

export type ToolStep = { title: string; body: string };
export type ToolFAQ = { q: string; a: string };

export type ToolCopy = {
  key: string;
  title: string;
  subtitle: string;
  availability: string;
  what: string[];           // Paragraphs of "What This Tool Does"
  howItWorks: ToolStep[];   // 4 numbered steps
  needList: string[];       // "What You'll Need" bullets
  getList: string[];        // "What You'll Get" bullets
  faqs: ToolFAQ[];
  disclaimer: string;
};

// Every tool ships the same standard disclaimer (only the tool name varies).
const disclaimerFor = (name: string) =>
  `Information only, not advice. ${name} uses AI to help you understand your own aged care information in plain English. It does not give financial, legal, or medical advice, and it is not a decision from My Aged Care or Services Australia. AI can make mistakes, so please check anything important against your official statements, your provider, or My Aged Care on 1800 200 422 before you act on it. Figures shown are indicative and subject to the current Schedule of Subsidies and Supplements.`;

export const TOOL_COPY: Record<string, ToolCopy> = {
  'statement-decoder': {
    key: 'statement-decoder',
    title: 'Statement Decoder',
    subtitle: 'Upload, photograph, or paste any Support at Home monthly statement. We accept PDF, Word, photos, and more. Get a plain-English breakdown in under 2 minutes.',
    availability: 'Free tool. 1 decode per day.',
    what: [
      'Your monthly Support at Home statement lists the services you received, what the government paid, and what you contributed. It is meant to be clear, but the line items, service IDs and contribution rates can be hard to follow.',
      'Statement Decoder reads your statement and explains it in plain English. It tells you what each charge is for, which service category it sits in (clinical, independence or everyday living), and how your contribution was worked out. Clinical care should show a $0 contribution, so if it does not, the tool points that out.',
      'It also flags anything that looks off, like a charge for a service you do not recognise, a contribution rate that seems high for your situation, or a possible duplicate. Flagged items are prompts to ask a question, not conclusions. You always check anything important with your provider or My Aged Care.',
    ],
    howItWorks: [
      { title: 'Upload Your Statement', body: 'Add a recent monthly statement as a PDF or a clear photo. Your provider must send you one each month.' },
      { title: 'Wayly Reads It', body: 'The tool pulls out each line item, the service category, the price, and your contribution.' },
      { title: 'See It in Plain English', body: 'Every charge is explained in plain words, with clinical, independence and everyday living grouped clearly.' },
      { title: 'Review the Flags', body: 'Anything unusual is highlighted with a short note on why, so you know what to ask your provider.' },
    ],
    needList: [
      'A recent monthly Support at Home statement (PDF or a clear photo)',
      'If you have it, your classification level (1 to 8) and your contribution rate, for a closer read',
    ],
    getList: [
      'A plain-English explanation of every charge on the statement',
      'Each service sorted into clinical, independence or everyday living',
      'Flags on anything unusual, with a short reason for each',
      'A short list of questions you can take to your provider',
    ],
    faqs: [
      { q: 'What kind of statement can I upload?', a: 'A monthly Support at Home statement from your provider. Providers must send one each month, even in months with no services.' },
      { q: 'Does a flag mean I have been overcharged?', a: 'No. A flag means something is worth a closer look. It is a prompt to ask your provider or My Aged Care, not a finding.' },
      { q: 'Should clinical care ever have a contribution?', a: 'Clinical supports like nursing and allied health are fully government funded, so they should show a $0 contribution. From 1 October 2026, personal care also becomes fully funded.' },
      { q: 'Is my statement stored safely?', a: 'Your data stays in your account and is not shared. See our privacy information for detail.' },
    ],
    disclaimer: disclaimerFor('Statement Decoder'),
  },

  'budget-calculator': {
    key: 'budget-calculator',
    title: 'Budget Calculator',
    subtitle: 'Work out what your classification provides each quarter and what is left to spend across your services.',
    availability: 'Budget Calculator is available on Solo and Family plans.',
    what: [
      'Under Support at Home, your assessed classification (1 to 8) sets an annual budget that is delivered as four quarterly budgets. Up to 10% of each quarter is set aside for care management, and you can carry over unspent funds up to $1,000 or 10% of the quarter, whichever is greater.',
      'Budget Calculator helps you see how your quarterly budget breaks down: what goes to care management, what is left for services, and how that might spread across clinical, independence and everyday living supports. It also notes the separate AT-HM scheme for equipment and home modifications, which does not come out of your quarterly budget.',
      'All amounts are indicative and indexed each 1 July, so the tool points you to the current Schedule of Subsidies and Supplements for confirmed figures. It is here to help you plan and ask better questions, not to set your budget. Your provider sets your individualised budget.',
    ],
    howItWorks: [
      { title: 'Enter Your Classification', body: 'Choose your classification level (1 to 8), or a transitioned HCP level if that applies to you.' },
      { title: 'See Your Quarterly Budget', body: 'The tool shows the indicative quarterly amount and sets aside the care management share.' },
      { title: 'Map It to Your Services', body: 'See how the remaining funds could spread across clinical, independence and everyday living.' },
      { title: 'Plan Ahead', body: 'Check carryover room and note any AT-HM needs that sit outside the quarterly budget.' },
    ],
    needList: [
      'Your Support at Home classification level (1 to 8), or your transitioned HCP level',
      'A rough idea of the services you use or plan to use',
    ],
    getList: [
      'An indicative quarterly budget for your classification',
      'A clear split between care management and money available for services',
      'A plain view of how funds could spread across the three service categories',
      'A note on carryover limits and the separate AT-HM scheme',
    ],
    faqs: [
      { q: 'Are these the exact dollar amounts I will receive?', a: 'They are indicative and indexed each 1 July. Always confirm with the current Schedule of Subsidies and Supplements or your provider.' },
      { q: 'What is the 10% for?', a: 'Up to 10% of each quarterly budget covers care management, such as planning and coordinating your services.' },
      { q: 'Can I save unspent funds?', a: 'You can carry over up to $1,000 or 10% of your quarterly budget, whichever is greater, into the next quarter.' },
      { q: 'Does equipment come out of this budget?', a: 'No. Assistive technology and home modifications are funded separately through the AT-HM scheme.' },
    ],
    disclaimer: disclaimerFor('Budget Calculator'),
  },

  'price-checker': {
    key: 'price-checker',
    title: 'Provider Price Checker',
    subtitle: "Compare what your provider charges for common services against the legislated maximum service prices.",
    availability: 'Provider Price Checker is available on Solo and Family plans.',
    what: [
      'Price caps deferred. The Australian Government announced in May 2026 that the planned 1 July 2026 national provider price caps under Support at Home are deferred indefinitely. Providers continue to set their own prices. This tool compares your provider\u2019s rate against indicative network medians, not a government cap. If you believe you have been overcharged, the Aged Care Quality and Safety Commission can order refunds.',
      "Under Support at Home, the government sets maximum service prices for each service type. Providers can charge less, but not more. The Price Checker helps you see your provider's rate next to the cap so you can spot when something looks high.",
      "Paste in the service name, units (hours or kilometres), and the rate your provider charges. The tool shows the legislated cap, the share you would contribute at your contribution rate, and whether the price is within bounds. It does not negotiate for you, but it gives you the facts to start a calm conversation.",
      'All caps are indexed each 1 July from the current Schedule of Subsidies and Supplements. We update our reference values when they change, but always confirm the live figure on the My Aged Care website before relying on it for a decision.',
    ],
    howItWorks: [
      { title: 'Enter the Service', body: "Pick the service type from the list and add the units (hours, kilometres) and your provider's rate." },
      { title: 'See the Cap', body: 'The tool shows the legislated maximum and whether your rate is above, at, or below it.' },
      { title: 'Estimate Your Contribution', body: 'Adjust your contribution rate to see what the service would cost you out of pocket.' },
      { title: 'Ask Better Questions', body: 'Take the numbers into a conversation with your provider, or use them to compare quotes.' },
    ],
    needList: [
      "The service name and your provider's rate (per hour, per kilometre, or per visit)",
      'Your contribution rate, if you know it (the tool defaults to common values)',
    ],
    getList: [
      "A side-by-side view of your provider's rate vs. the legislated maximum",
      'An estimate of your out-of-pocket share at your contribution rate',
      'A clear status flag (within cap, at cap, or above cap)',
      'Notes on what the service usually covers under Support at Home',
    ],
    faqs: [
      { q: 'Are these caps current?', a: 'They reflect the most recent Schedule of Subsidies and Supplements. Always confirm the live figure on My Aged Care before relying on it.' },
      { q: 'What if my provider charges above the cap?', a: 'Providers must not charge above the legislated maximum. If you see a rate above the cap, raise it with your provider and, if needed, the Aged Care Quality and Safety Commission.' },
      { q: 'Does the cap include GST?', a: 'Service prices under Support at Home are usually GST-free, but always check the line items on your statement.' },
      { q: 'Can the cap change mid-year?', a: 'Yes. Caps are indexed on 1 July each year and can be adjusted by the Department. The tool reflects the current values we hold.' },
    ],
    disclaimer: disclaimerFor('Provider Price Checker'),
  },

  'classification-check': {
    key: 'classification-check',
    title: 'Classification Self-Check',
    subtitle: 'Get a sense of which classification level (1 to 8) might apply, based on common assessment indicators.',
    availability: 'Classification Self-Check is available on Solo and Family plans.',
    what: [
      'Your Support at Home classification (1 to 8) is decided through the Single Assessment System, where a trained assessor looks at your needs, your daily routine and your goals. Wayly cannot make that decision, and neither can this tool.',
      'Classification Self-Check helps a family understand how classifications generally work and which level might be in the picture, based on common indicators like help needed with daily tasks, mobility, and clinical needs. Lower classifications (1 to 3) suit mostly independent people, mid-range (4 to 6) cover regular personal and household support, and higher (7 to 8) cover complex, often daily, care.',
      'This is information only, not a substitute for an assessment. It is meant to help you feel prepared for a conversation with My Aged Care, not to predict an outcome.',
    ],
    howItWorks: [
      { title: 'Answer a Few Plain Questions', body: 'Tell the tool about daily tasks, mobility, and any clinical or memory needs.' },
      { title: 'See Where That Sits', body: 'The tool shows which classification range those indicators often line up with.' },
      { title: 'Read What Each Level Means', body: 'Plain summaries explain the kind of support each range tends to fund.' },
      { title: 'Prepare for Assessment', body: 'Take notes into a conversation with My Aged Care or your assessor.' },
    ],
    needList: [
      'A general picture of the daily help needed (personal care, household tasks, mobility)',
      'Any notes about clinical needs or memory changes',
    ],
    getList: [
      'An indicative classification range, with clear reasoning',
      'Plain summaries of what lower, mid and higher classifications tend to fund',
      'A short list of points to raise at assessment',
      'A clear reminder that only an assessor decides your classification',
    ],
    faqs: [
      { q: 'Will this set my classification?', a: 'No. Only the Single Assessment System decides your classification. This is information only.' },
      { q: 'Why does it give a range, not one number?', a: 'Classifications depend on a full assessment. A range reflects the indicators you enter without pretending to be the assessment.' },
      { q: 'Can I ask for a reassessment if my needs change?', a: 'Yes. You or your family can contact My Aged Care on 1800 200 422 at any time.' },
      { q: 'We were on a Home Care Package. Does that change things?', a: 'If you transitioned from HCP, you may be on a transitioned level until a reassessment moves you into one of the eight classifications.' },
    ],
    disclaimer: disclaimerFor('Classification Self-Check'),
  },

  'reassessment-letter': {
    key: 'reassessment-letter',
    title: 'Reassessment Letter Drafter',
    subtitle: 'Draft a clear, polite letter to request a reassessment, a care-plan change, or to move from CHSP into Support at Home.',
    availability: 'Reassessment Letter Drafter is available on Solo and Family plans.',
    what: [
      "When a parent's needs change, the right next step is often a conversation with My Aged Care or your provider. The Reassessment Letter Drafter writes that letter for you, using your notes, in plain English.",
      'Choose the type of letter (a reassessment request, a care-plan amendment, or a CHSP-to-Support-at-Home transition request), describe what has changed, and the tool produces a draft you can review, edit, and send. You always read the draft before sending. Wayly never sends anything on your behalf.',
      'The draft includes the facts that matter (recent changes, dates, supporting evidence) and asks for a specific outcome. It is calm, polite and clear, the tone families say works best when they want to be taken seriously without sounding combative.',
    ],
    howItWorks: [
      { title: 'Pick the Letter Type', body: 'Reassessment, care-plan amendment, or CHSP-to-SAH transition. Each one uses a slightly different structure.' },
      { title: 'Describe What Has Changed', body: 'Add the dates, the new circumstances, and what you would like to happen next.' },
      { title: 'Wayly Drafts the Letter', body: 'You get a plain-English draft, properly formatted, ready to review.' },
      { title: 'Review, Edit, Send', body: 'Read it carefully. Check every fact. Send when you are ready. Wayly never sends on your behalf.' },
    ],
    needList: [
      'The dates when things changed (an event, a new diagnosis, a hospital stay)',
      'Any supporting evidence you can refer to (a GP letter, a discharge summary, a care plan)',
    ],
    getList: [
      'A draft letter in your voice, in plain English',
      'A clear request for a specific outcome',
      'A short list of supporting points to attach',
      'A printable, sendable PDF and a copy in your account',
    ],
    faqs: [
      { q: 'Does Wayly send the letter?', a: 'No. The tool drafts; you send. You stay in control of every word and every recipient.' },
      { q: 'Where do I send it?', a: 'Reassessment requests go to My Aged Care on 1800 200 422 or via your assessor. Care-plan amendments go to your provider. The tool tells you which address to use for each letter type.' },
      { q: 'How long does a reassessment take?', a: "Wait times vary. My Aged Care typically responds within 2 to 8 weeks; complex cases can take longer. The tool helps you write a follow-up if you don't hear back." },
      { q: 'Can I use this for the CHSP-to-Support-at-Home transition?', a: "Yes. Pick 'Reassessment / classification' as the type and mention that your parent is currently on CHSP. The tool produces the right framing." },
    ],
    disclaimer: disclaimerFor('Reassessment Letter Drafter'),
  },

  'contribution-estimator': {
    key: 'contribution-estimator',
    title: 'Contribution Estimator',
    subtitle: 'Estimate what you would contribute towards Support at Home services based on your income, your assets, and the service category.',
    availability: 'Contribution Estimator is available on Solo and Family plans.',
    what: [
      'Under Support at Home, your contribution depends on your income, your assets, and which category a service sits in. Clinical care is fully government funded, no contribution. Independence and everyday living services attract a contribution that scales with your means.',
      'The Contribution Estimator walks through the common inputs (income, assets, partnered status, and Commonwealth Seniors Health Card status) and shows what your contribution rate is likely to be. It also explains the no-worse-off guarantee, which protects people who transitioned from a Home Care Package or were on the National Priority Queue before 12 September 2024.',
      'This is an estimate, not an assessment. Services Australia decides your real contribution rate based on your means assessment. The tool exists to help you plan, not to replace that assessment.',
    ],
    howItWorks: [
      { title: 'Enter Your Means', body: 'Add income, assets, partnered status, and whether you hold a Commonwealth Seniors Health Card.' },
      { title: 'See the Indicative Rate', body: 'The tool shows the contribution rate likely to apply to each service category.' },
      { title: 'Estimate Out-of-Pocket Costs', body: 'See what a typical week or month of services might cost you at that rate.' },
      { title: 'Plan Your Budget', body: 'Use the figures to work out what is affordable and what to prioritise.' },
    ],
    needList: [
      "A general picture of your income (or your parent's), including pension and superannuation",
      'An estimate of assets (home equity, savings, investments)',
      'Whether you are partnered and whether you hold a Commonwealth Seniors Health Card',
    ],
    getList: [
      'An indicative contribution rate for each service category',
      'An out-of-pocket estimate for a typical week or month',
      'A plain explanation of the no-worse-off guarantee, if it applies',
      'A note on what counts as income and assets, so you can sanity-check the inputs',
    ],
    faqs: [
      { q: 'Is this my real contribution rate?', a: 'No. Services Australia decides your real contribution rate through a means assessment. This is an estimate to help you plan.' },
      { q: 'How does the no-worse-off guarantee work?', a: 'If you were on a Home Care Package or the National Priority Queue before 12 September 2024, your contribution will not be higher than it would have been under the old rules.' },
      { q: 'Why is clinical care free?', a: 'Clinical supports like nursing and allied health are fully government funded. From 1 October 2026, personal care is also fully funded.' },
      { q: 'Does my home count as an asset?', a: 'Generally, your principal home is partially excluded from the means assessment. The exact rules depend on your circumstances; the estimator uses the common defaults.' },
    ],
    disclaimer: disclaimerFor('Contribution Estimator'),
  },

  'care-plan-reviewer': {
    key: 'care-plan-reviewer',
    title: 'Care Plan Reviewer',
    subtitle: 'Paste your care plan and get a plain-English read on what each service does and where the gaps might be.',
    availability: 'Care Plan Reviewer is available on Solo and Family plans.',
    what: [
      'A Support at Home care plan lists the services your provider thinks you need, how often you will get them, and who delivers each one. It is the spine of your everyday life with the program, but it is often written in service-codes and acronyms that families find hard to parse.',
      "Care Plan Reviewer reads your care plan and explains it in plain English. Each service is grouped into clinical, independence or everyday living, and the tool notes anything that looks unusual: a service you would expect to see and don't, hours that look light for your classification, or a service category that is fully missing.",
      'It does not change your care plan. Only your provider can do that. The tool is here to help you prepare for the conversation: which questions to ask, which goals to revisit, and which services to query.',
    ],
    howItWorks: [
      { title: 'Paste Your Care Plan', body: 'Copy the text from your care plan PDF, or upload the PDF directly.' },
      { title: 'Wayly Reads It', body: 'Each service is identified, categorised, and explained in plain English.' },
      { title: 'See the Gaps', body: 'The tool flags anything that looks light, missing, or worth a closer look for your classification.' },
      { title: 'Prepare Your Questions', body: 'Take a short list of points into your next care-plan review with your provider.' },
    ],
    needList: [
      'Your current care plan (the document your provider gave you, usually a PDF or print-out)',
      'Your classification level, if you know it, for a closer read',
    ],
    getList: [
      'A plain-English summary of every service on the plan',
      'Each service grouped into clinical, independence or everyday living',
      'Flags on missing or light services for your classification',
      'A short list of questions to take into your next review',
    ],
    faqs: [
      { q: 'Can Wayly change my care plan?', a: 'No. Only your provider can change your care plan. The tool helps you prepare for that conversation.' },
      { q: 'How often should a care plan be reviewed?', a: 'At least once a year, and any time your needs change. You can also ask for a review at any time by contacting your provider.' },
      { q: 'What if a service is missing?', a: 'Raise it with your provider. If you cannot agree, you can ask for a reassessment via My Aged Care on 1800 200 422.' },
      { q: 'Does this work for transitioned HCP care plans?', a: 'Yes. Paste the plan in and the tool reads it the same way. Transitioned plans use slightly different language; the tool maps it to the Support at Home structure.' },
    ],
    disclaimer: disclaimerFor('Care Plan Reviewer'),
  },

  'aged-care-qa': {
    key: 'aged-care-qa',
    title: 'Aged Care Q&A',
    subtitle: 'Ask a plain-English question about Support at Home, CHSP, or aged care funding, and get a clear answer grounded in current rules.',
    availability: 'Aged Care Q&A is available on Solo and Family plans.',
    what: [
      'Aged Care Q&A is a chat-style assistant that answers everyday questions about Support at Home, the Commonwealth Home Support Programme (CHSP), classifications, contribution rates, the Schedule of Subsidies and Supplements, and how the transition from Home Care Packages works.',
      'Ask anything: How does the no-worse-off guarantee work? Why is clinical care free? Can my parent carry over unused funding? What is the difference between independence and everyday living services? The tool answers in plain English and cites the rule or fact sheet it is drawing from.',
      "It is grounded in the public rules and our own checked notes, but it is not a decision-making tool. For anything that affects your parent's funding, always confirm with My Aged Care, your provider, or Services Australia before acting.",
    ],
    howItWorks: [
      { title: 'Type Your Question', body: 'Use everyday language. No need to know the right jargon.' },
      { title: 'Get a Plain-English Answer', body: 'The assistant responds with a clear explanation and links to source material where it matters.' },
      { title: 'Ask Follow-Ups', body: 'Keep the conversation going. The assistant remembers what you have already asked in this session.' },
      { title: 'Take It Forward', body: 'Copy the answer, save it to your account, or use it to prepare questions for your next call with My Aged Care.' },
    ],
    needList: [
      'A question. That is it.',
      'Optional: context about your situation (classification, current services, recent changes) for a closer answer',
    ],
    getList: [
      'A clear, plain-English answer to your question',
      'Citations or pointers to the relevant fact sheet or rule',
      'A short list of follow-up questions you might want to ask',
      'A copyable transcript you can share with siblings or your provider',
    ],
    faqs: [
      { q: 'Is this advice?', a: 'No. It is information. For anything that affects your funding, confirm with My Aged Care, your provider, or Services Australia before acting.' },
      { q: 'Is my conversation private?', a: 'Yes. Your chat history is stored in your account and is not shared. See our privacy information for detail.' },
      { q: 'Can it answer questions about my specific statement?', a: 'For statement-specific questions, the Statement Decoder is more accurate. Use Aged Care Q&A for general questions about the program.' },
      { q: 'Does it know about the 1 October 2026 changes?', a: "Yes. Personal care becoming fully government funded, the lifetime cap framework, and the CHSP transition timeline are all in the assistant's working knowledge." },
    ],
    disclaimer: disclaimerFor('Aged Care Q&A'),
  },
};

export function getToolCopy(key: string): ToolCopy | undefined {
  return TOOL_COPY[key];
}
