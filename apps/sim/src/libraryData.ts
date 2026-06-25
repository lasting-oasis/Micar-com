// ============================================================================
//  DEALER LIBRARY
//  Cornerstone reference reading for the dealership. To ADD A BOOK, copy one of
//  the objects below and append it to LIBRARY_BOOKS. Each book just needs an id,
//  title, category, a one-line summary, and a list of { heading, body } sections.
//  Use blank lines (\n\n) inside `body` to separate paragraphs.
// ============================================================================

export type LibrarySection = { heading: string; body: string };

export type LibraryBook = {
  id: string;
  title: string;
  category: string;   // shelf label, e.g. "Compliance", "Buying", "F&I"
  author?: string;
  summary: string;    // one line shown on the shelf
  sections: LibrarySection[];
};

export const LIBRARY_BOOKS: LibraryBook[] = [
  {
    id: 'car-dealer-101',
    title: 'Car Dealer 101',
    category: 'Start Here',
    author: 'The Dealer Primer',
    summary: 'The whole business in one read — how a used-car lot actually makes money.',
    sections: [
      {
        heading: 'What a dealer really does',
        body: 'A used-car dealer is an arbitrage and reconditioning business. You buy vehicles below retail (at auction, trade-ins, private deals), make them safe, clean, and sale-ready, and sell them to retail customers for more than your all-in cost. The profit lives in the gap between "all-in cost" and "retail price" — minus everything it costs to get there. Master that gap and you have a business; ignore it and you have an expensive parking lot.'
      },
      {
        heading: 'The daily loop',
        body: 'Acquire → Inspect → Recondition → Inspect & Title → Display → Sell → Collect. Every car you own should be moving forward through that loop every single day. A car that stops moving (waiting on a repair, an inspection, a title) is costing you money while it sits. Your job as the operator is to keep cars flowing and to keep the loop short.'
      },
      {
        heading: 'The four levers of profit',
        body: '1) Buy right — your profit is mostly made the day you buy, not the day you sell.\n2) Recondition smart — fix what affects safety and sale, skip vanity spend.\n3) Turn fast — every extra day on the lot eats margin through overhead and floor-plan interest.\n4) Sell well — match the right car to the right buyer and protect your gross in negotiation.'
      },
      {
        heading: 'Know your all-in cost',
        body: 'Before you ever set a price, total it up: purchase price + transport + reconditioning + parts + inspection + title/registration + the floor-plan interest you expect to pay while it sits. That number is your floor. Sell above it and you made money; sell below it and you paid someone to take your car. Never forget the costs that don\'t show up on the windshield.'
      },
      {
        heading: 'Cash is the lifeblood',
        body: 'Overhead, payroll, marketing, and floor-plan interest run every day whether or not you sell a car. A dealer rarely fails because of one bad deal — they fail by running out of cash while too much money is tied up in slow inventory. Watch your liquid cash, keep inventory turning, and don\'t let your ego buy a car your wallet can\'t carry.'
      },
      {
        heading: 'Beginner mistakes to avoid',
        body: 'Overpaying at auction because you "love" a car. Skipping the pre-purchase inspection and getting surprised by a blown transmission. Sinking cash into cosmetic recon that doesn\'t raise the price. Letting units age on the lot. Writing in-house finance paper you can\'t afford to have default. Selling a known problem to a trusting buyer and torching your reputation. Slow down, run the numbers, and let the math — not emotion — make the call.'
      }
    ]
  },
  {
    id: 'deal-math-101',
    title: 'The Deal Math: How Profit Is Made',
    category: 'Start Here',
    summary: 'Front-end gross, recon, holding cost, and the numbers behind a profitable unit.',
    sections: [
      {
        heading: 'Front-end gross',
        body: 'Front-end gross = retail sale price − all-in cost (purchase + recon + fees + transport). It is the headline profit on the car itself. A healthy used-car front-end gross is typically a few thousand dollars per unit, but it varies wildly by price band — cheaper cars carry thinner dollars but can turn faster.'
      },
      {
        heading: 'Holding cost is a clock',
        body: 'From the moment you buy, the meter runs: floor-plan interest accrues daily, and a share of your fixed overhead is attributable to every car on the lot. A unit that sits 60 days can quietly burn hundreds in carry. That is why "buy right and turn fast" beats "hold out for top dollar" almost every time.'
      },
      {
        heading: 'Back-end and F&I',
        body: 'Beyond the car, money is made in financing: dealer reserve on bank deals, and the interest yield on in-house (buy-here-pay-here) paper. F&I can rival or exceed front-end gross — but in-house paper also carries default risk, so price that risk in and never finance more than you can afford to lose.'
      },
      {
        heading: 'A simple worked example',
        body: 'Buy a sedan for $9,000. Transport $300, recon $1,200, inspection + title ~$200 → all-in ≈ $10,700. Retail it at $13,900 cash. Front-end gross ≈ $3,200, minus ~$250 of floor-plan carry for the days it sat ≈ $2,950 net. Finance it instead of cash and you may add several hundred more in reserve or interest. Run this math BEFORE you buy — if it doesn\'t pencil out, pass.'
      }
    ]
  },
  {
    id: 'nc-compliance',
    title: 'NC Dealer Compliance & State Inspections',
    category: 'Compliance',
    author: 'NC Dealer Desk Reference',
    summary: 'Safety + emissions, salvage/rebuilt titles, and what must happen before a car is sold.',
    sections: [
      {
        heading: 'Inspect before you retail',
        body: 'In North Carolina a used vehicle must pass a state Safety inspection before a dealer offers it for retail sale. Build the inspection into your get-ready process — never advertise or deliver a car that has not cleared inspection. Keep the inspection receipt with the deal jacket as proof of compliance.'
      },
      {
        heading: 'Emissions (OBD-II) counties',
        body: 'Emissions inspections are required in 19 NC counties — including Mecklenburg, Gaston, Cabarrus, Union, Iredell and Lincoln — and are performed at the same time as the safety inspection.\n\nExemption: a vehicle within the three newest model years AND under 70,000 miles is exempt from the emissions test (safety still applies). Newer, low-mileage stock is cheaper and faster to certify.'
      },
      {
        heading: 'Salvage to rebuilt title',
        body: 'A salvage vehicle must be fully repaired and pass the required safety/emissions inspection before it can be retitled. Vehicles six model years old or newer also require an anti-theft inspection by the DMV License & Theft Bureau, which verifies the VIN and checks for stolen parts. You will submit the inspector\'s report, the salvage title, and a rebuilder\'s affidavit listing the total cost of repairs. Once approved, the title is branded "Rebuilt."'
      },
      {
        heading: 'Why it matters to your bottom line',
        body: 'A clean, properly inspected and titled car sells faster and holds value. A rebuilt title sells for less than a clean title but more than salvage, so the rebuild only pays off when the repair cost plus inspection fees stay well under the retail spread. Always run the math before committing to a salvage rebuild.'
      }
    ]
  },
  {
    id: 'buying-auction',
    title: 'Buying Inventory: Auctions, Values & Title Brands',
    category: 'Buying',
    summary: 'Reading MMR vs. clean retail, title brands, condition tiers, and the pre-purchase inspection.',
    sections: [
      {
        heading: 'MMR vs. clean retail',
        body: 'Two numbers anchor every buy. Clean Retail is roughly what the car sells for to a retail customer in good condition. Wholesale (MMR) is what the car is worth between dealers — typically around 80% of clean retail. You make money in the spread between what you pay at wholesale (plus recon and fees) and what you retail it for.'
      },
      {
        heading: 'Title brands',
        body: 'Clean: no major history; commands the most money and the easiest financing.\n\nRebuilt: a salvage vehicle repaired and re-inspected; sells for less and many banks will not finance it.\n\nSalvage: declared a total loss; cannot be retailed as-is and must be rebuilt and re-titled first. Salvage and rebuilt units are cheap to acquire but carry recon risk and a smaller buyer pool.'
      },
      {
        heading: 'Condition and the pre-purchase inspection',
        body: 'Mileage, mechanical condition, and body/structural condition drive the real value. A pre-purchase (PSI) inspection reveals the punch list of defects before you commit your money. Pay for the inspection on anything you can\'t see clearly — a missed transmission or frame issue can wipe out the entire profit on a unit.'
      },
      {
        heading: 'Buy the spread, not the car',
        body: 'Discipline beats enthusiasm. Before you bid, estimate: purchase price + transport + reconditioning + inspection/registration + floor-plan carry for the days you expect to hold it. If that total does not leave a healthy margin under realistic retail, pass. There is always another car.'
      }
    ]
  },
  {
    id: 'recon',
    title: 'Reconditioning & Get-Ready',
    category: 'Operations',
    summary: 'Turning a fresh buy into a frontline, sale-ready unit — pre-inspection, repairs, parts, and labor.',
    sections: [
      {
        heading: 'The get-ready loop',
        body: 'Every car follows the same path from the back lot to the front line: pre-inspection (find the faults) → repair the mechanical and body defects → wash & detail → state safety/emissions inspection → title & register → display for sale. A tight, repeatable get-ready process is what separates a profitable lot from a parking lot full of dead inventory.'
      },
      {
        heading: 'Pre-inspection punch list',
        body: 'Start with a pre-inspection to officialize the punch list. Mechanical faults (brakes, engine, transmission, steering) must be sound for a safety pass; structural body damage also matters for safety, while cosmetic paint does not affect the inspection but does affect price. Fix the safety items first — they are what gate the sale.'
      },
      {
        heading: 'Parts vs. cash and the master technician',
        body: 'You can pay cash for each repair or consume a part you already own from inventory (scrapping junk cars feeds your parts shelf). Hiring a Master Mechanic costs a daily wage but cuts repair costs and removes the chance of a failed repair — worth it once your volume is high enough that the wage is cheaper than the wasted parts and re-dos.'
      }
    ]
  },
  {
    id: 'bodyshop-101',
    title: 'Body Shop Business 101',
    category: 'Body Shop',
    author: 'The Collision Primer',
    summary: 'Running a collision & paint shop — estimates, insurance, cycle time, and where the money is.',
    sections: [
      {
        heading: 'What a body shop does',
        body: 'A body (collision) shop restores a vehicle\'s exterior and structure after damage — dents, crushed panels, bent frames, cracked bumpers, and faded or scraped paint. The goal is to return the car to pre-accident, safe, and sale-ready condition. For a dealer, an in-house or partner body shop turns rough trade-ins and auction buys into frontline units instead of wholesale dumps.'
      },
      {
        heading: 'The repair order flow',
        body: 'Every job moves through stages: Intake & damage assessment → estimate / teardown → order parts → body & frame work → prep & paint → reassembly → QC and detail → delivery. A job is only earning when it is actively being worked; a car waiting on a part or a paint booth is dead time. Keeping jobs flowing through the bays is the whole game.'
      },
      {
        heading: 'Where the money comes from',
        body: 'Three buckets: labor (body, frame, and paint hours billed at your door rate), parts (bought at cost, billed with markup), and paint & materials (charged per refinish hour). Labor is the core — a shop lives or dies on billed hours per bay per day. Price your labor rate to your market and your techs\' skill; undercharging labor is the fastest way to be busy and broke.'
      },
      {
        heading: 'Insurance vs. customer-pay',
        body: 'Most collision volume is insurance work. That means writing estimates the adjuster will approve, filing supplements when teardown reveals hidden damage, and choosing OEM vs. aftermarket/recycled (LKQ) parts within the claim. Direct-repair (DRP) relationships bring steady volume but squeeze rates. Customer-pay and dealer recon work usually carry better margins but less steady flow.'
      },
      {
        heading: 'The metrics that matter',
        body: 'Cycle time (keys-to-keys days) and touch time tell you how fast cars move and how much of that is real work vs. waiting. Throughput per bay is your earning ceiling. Watch comebacks (jobs that return for rework) — a paint mismatch or a missed supplement destroys both margin and reputation. Faster, cleaner cycle time means more cars through the same bays and more billed hours.'
      },
      {
        heading: 'Common pitfalls',
        body: 'Under-writing the estimate and eating the supplement. Slow parts procurement stalling jobs in the bay. Paint that doesn\'t match, forcing a redo. Undercharging labor because you\'re chasing volume. And the classic: too much cash tied up in torn-down cars waiting on approvals or parts. Estimate thoroughly, order parts early, protect your labor rate, and keep the bays turning.'
      }
    ]
  },
  {
    id: 'fni',
    title: 'F&I: Financing, BHPH & The Floor Plan',
    category: 'F&I',
    summary: 'Cash, bank, and in-house deals; the floor plan and carrying cost; repossession and subprime risk.',
    sections: [
      {
        heading: 'Three ways a car gets sold',
        body: 'Cash: the customer pays in full — simplest and cleanest.\n\nBank/Outside finance: a lender funds the deal and you collect the proceeds plus a dealer reserve. Lenders generally will not finance salvage/rebuilt units.\n\nIn-house / Buy-Here-Pay-Here (BHPH): you become the bank. You collect a down payment and the customer pays you over time at a high rate. The upside is large total yield; the risk is default.'
      },
      {
        heading: 'The floor plan (carrying cost)',
        body: 'A floor plan is a revolving credit line that lets you buy inventory without tying up all your cash. It is not free money — you pay daily interest on the balance for every day the car sits. This carrying cost is exactly why aged inventory is the enemy: a unit that sits for 60 days quietly eats its own profit. Pay off floor-plan debt as cars sell, and watch your days-on-lot.'
      },
      {
        heading: 'BHPH risk and repossession',
        body: 'In-house paper can be very profitable, but a share of subprime customers will go delinquent. When a contract stops paying, you can order a repossession; the vehicle comes back (usually a little rougher) to re-sell, but you eat the repo cost and lost payments. A hired F&I/finance manager lowers the default rate. Price the risk in — do not write paper you cannot afford to have go bad.'
      }
    ]
  },
  {
    id: 'sales',
    title: 'The Sales Process & Reputation',
    category: 'Sales',
    summary: 'Working walk-ins, negotiation and counter-offers, trade-ins, marketing, and protecting your reputation.',
    sections: [
      {
        heading: 'Walk-ins and demand',
        body: 'Customers arrive based on your marketing spend and your reputation. Each shopper has a budget, a credit score, and a tolerance for defects. Match the right car to the right buyer — a tight-budget, high-knowledge shopper is not the customer for an over-priced unit with hidden faults.'
      },
      {
        heading: 'Negotiation and counter-offers',
        body: 'Every shopper has patience. Counter too aggressively and they walk; leave money on the table and you erode margin. Desperate buyers and trade-ins give you room. A good salesperson on payroll improves your take on cash and bank deals. Know your floor (cost + recon + fees) and never sell under it.'
      },
      {
        heading: 'Reputation is an asset',
        body: 'Selling a clean, honest car to the right buyer builds reputation, which raises walk-in volume over time. Dumping a lemon on an unsuspecting, low-knowledge buyer can win one deal and cost you many future ones. Reputation compounds — guard it like cash.'
      }
    ]
  },
  {
    id: 'operations',
    title: 'Running the Store: Overhead, Staff & Scaling',
    category: 'Operations',
    summary: 'Daily overhead by lot size, payroll, reading your P&L, and knowing when to grow.',
    sections: [
      {
        heading: 'Fixed cost never sleeps',
        body: 'Your lot carries overhead every single day — rent, utilities, insurance — and it scales with lot size. Payroll for any staff you hire (mechanic, salesperson, F&I manager) is on top of that. These costs run whether or not you sell a car, so idle inventory and empty days are pure bleed.'
      },
      {
        heading: 'Read the daily P&L',
        body: 'Watch the balance sheet: income (sales, finance payments) versus expenses (overhead, payroll, floor-plan interest, marketing, recon). Profit is what is left. If lastTick expenses regularly beat income, you are over-staffed, over-marketed, or sitting on aged inventory — fix the cause, not the symptom.'
      },
      {
        heading: 'When to scale up',
        body: 'A larger lot holds more inventory and lifts your ceiling, but it also raises fixed overhead and demands more working capital and faster turns. Upgrade only when you are consistently capacity-constrained and turning cars quickly. Growth that outruns your cash and your turn rate is how dealers go under.'
      }
    ]
  },
  {
    id: 'fractional',
    title: 'Fractional Vehicle Shares (MyCar)',
    category: 'Investing',
    summary: 'Treating vehicles as tradable assets — shares, volatility, and building a portfolio.',
    sections: [
      {
        heading: 'What fractional ownership is',
        body: 'A vehicle can be split into tradable shares. Instead of buying a whole car, you buy a slice and gain exposure to its value. Each listed vehicle has a price-per-share, a volatility figure, and a 30-day price history you can read like any market chart.'
      },
      {
        heading: 'Volatility and the portfolio',
        body: 'Higher-volatility vehicles swing more day to day — more upside and more downside. Spread holdings across several vehicles to smooth the ride. Your portfolio tracks invested cost versus current value, so your return (P/L) is always visible. Buy lower, sell higher, and let the day-to-day price moves work for a patient holder.'
      }
    ]
  }
];
