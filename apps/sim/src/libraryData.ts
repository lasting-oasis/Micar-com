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
