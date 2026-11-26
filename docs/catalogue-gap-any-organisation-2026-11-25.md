# Any-organisation catalogue — capability gaps and candidate products

**Date:** 25 November 2026  
**Scope:** `content/capability-maps/any_organisation/2.json` (70 capabilities) against `content/catalogue/any_organisation/2.json` (6 entries).  
**Method:** joined the catalogue's capability links to the map by code; checked official vendor pages with an HTTP GET and a browser user agent on 25 November 2026. `403`/`000` means bot protection or a network timeout, not necessarily a dead page.

## Coverage after v2

- **17 of 70** capabilities have at least one product (7 before v2).
- **53** have no product.

### Covered

| Capability | Products |
|---|---|
| 2 Human Resources; 2.1 Workforce Planning; 2.2 Recruitment & Onboarding; 2.3 Learning & Development; 2.4 Pay, Reward & Pensions; 2.5 Employee Relations & Wellbeing | Workday Human Capital Management |
| 5 Customer Contact; 5.3 Case & Request Tracking; 5.4 Complaints & Feedback; 9.3 Relationship Management | ServiceNow Customer Service Management; Microsoft Dynamics 365 Customer Service |
| 8.1 Strategy & Performance; 8.2 Risk Management; 12.1 Portfolio & Programme Management | Planview AdaptiveWork |
| 10.1 Service Design; 12.2 Business Analysis & Design | Miro |
| 11.1 Work Planning & Scheduling; 11.2 Service Delivery | Microsoft Dynamics 365 Field Service |

### Corrections made in v2

- **Workday** was linked to **7 Digital & Technology**. It now links to the HR capabilities its page actually describes: core HR, workforce planning, recruitment, learning, pay/reward and employee wellbeing.
- **ServiceNow CSM** and **Dynamics 365 Customer Service** now link to **5 Customer Contact**, **5.3 Case & Request Tracking** and **5.4 Complaints & Feedback**. ServiceNow's unsupported **9.4 Feedback & Insight** link was removed.
- **Planview AdaptiveWork** now links to **8.1 Strategy & Performance** and **8.2 Risk Management**, both named features on its page.
- **Miro** keeps **10.1 Service Design** and gains **12.2 Business Analysis & Design**; its claim now matches the vendor's own words ("AI-powered visual workspace for collaboration, workshops and process mapping").

## Uncovered, by area

| Area | Uncovered |
|---|---|
| **1 Finance** | 1, 1.1–1.5 (6) |
| **3 Procurement** | 3, 3.1–3.4 (5) |
| **4 Information Management** | 4, 4.1–4.5 (6) |
| **5 Customer Contact** | 5.1 Contact Channels, 5.2 Identity & Account Verification, 5.5 Accessibility & Inclusion (3) |
| **6 Estates** | 6, 6.1–6.5 (6) |
| **7 Digital & Technology** | 7, 7.1–7.6 (7) |
| **8 Governance & Assurance** | 8, 8.3–8.6 (5) |
| **9 Customers & Stakeholders** | 9, 9.1 Understanding Needs, 9.2 Engagement & Communications, 9.4 Feedback & Insight (4) |
| **10 Products & Services** | 10, 10.2 Service Portfolio Management, 10.3 Pricing & Funding Models, 10.4 Quality Standards & Specifications (4) |
| **11 Delivery & Operations** | 11, 11.3 Supply & Partner Coordination, 11.4 Performance & Quality Monitoring (3) |
| **12 Change & Improvement** | 12, 12.3 Benefits Realisation, 12.4 Organisational Change, 12.5 Continuous Improvement (4) |

**Total 53** (parent codes included deliberately).

## Candidate products for the core gaps

Shortlist only. Each needs a date-stamped vendor statement and a named reviewer before it enters a version.

| Capability | Candidate | Official page | Status |
|---|---|---|---|
| 1 Finance, 1.1–1.5 | Oracle Fusion Cloud Financials | https://www.oracle.com/erp/financials/ | 200 |
| 1 Finance, 1.1–1.5 | Microsoft Dynamics 365 Finance | https://www.microsoft.com/en-us/dynamics-365/products/finance | 200 |
| 1 Finance, 1.1–1.5 | Workday Financial Management | https://www.workday.com/en-gb/products/financial-management.html | 200 |
| 1 Finance, 1.1–1.5 | SAP S/4HANA Finance | https://www.sap.com/products/financial-management.html | 403 (bot block; verify) |
| 3 Procurement, 3.1–3.4 | SAP Ariba | https://www.sap.com/products/ariba.html | 403 (bot block; verify) |
| 3 Procurement, 3.1–3.4 | Coupa | https://www.coupa.com/ | 403 (bot block; verify) |
| 4 Information Management, 4.1–4.5 | Microsoft Purview | https://www.microsoft.com/en-us/security/business/microsoft-purview | 200 |
| 4.5 Analytics & Business Intelligence | Microsoft Power BI | https://www.microsoft.com/en-us/power-platform/products/power-bi | 200 |
| 6 Estates, 6.1–6.5 | Planon | https://www.planonsoftware.com/ | 200 |
| 6 Estates, 6.1–6.5 | IBM TRIRIGA | https://www.ibm.com/products/tririga | 200 |
| 7 Digital & Technology, 7.1–7.6 | ServiceNow ITSM | https://www.servicenow.com/products/itsm.html | 000 (verify in browser) |
| 7 Digital & Technology, 7.1–7.6 | Atlassian Jira Service Management | https://www.atlassian.com/software/jira/service-management | 200 |
| 8 Governance & Assurance, 8.3–8.6 | ServiceNow GRC | https://www.servicenow.com/products/governance-risk-and-compliance.html | 000 (verify in browser) |
| 9.1 Understanding Needs, 9.4 Feedback & Insight | Qualtrics | https://www.qualtrics.com/ | 200 |
| 11.3 Supply & Partner Coordination | SAP Ariba / Coupa | (above) | 403 (verify) |
| 12.3–12.5 Change & Improvement | Planview AdaptiveWork | https://www.planview.com/products-solutions/products/adaptivework/ | 200 |
| 5.2 Identity & Account Verification | Microsoft Entra / Okta | (needs a specific product page) | not checked |

## Vendor batch 2 checked (25 November 2026)

| Product | Capabilities | Status |
|---|---|---|
| Ivalua | 3 Procurement; 3.1–3.4 | Added |
| Diligent One Platform | 8 Governance; 8.2–8.5 | Added |
| Workday Financial Management | 1 Finance; 1.1, 1.2, 1.4, 1.5 | Added |
| Qlik Cloud Analytics | 4.5 Analytics & BI | Added |

Coupa, SAP Ariba and ServiceNow GRC block scripted requests; Ivalua and Diligent stand in for procurement and GRC. ServiceNow ITSM is also blocked, but Jira Service Management already covers 7.2 and 7.6.

**Still open:** 5.1 Contact Channels, 5.2 Identity & Verification, 5.5 Accessibility; 7.1 Enterprise Architecture, 7.3 Infrastructure, 7.4 Cyber Security, 7.5 Digital Service Design; 8.6 Business Continuity; 9 Customers & Stakeholders; 10 Products & Services; 11 Delivery & Operations; 12 Change & Improvement.

## Recommended next wave

Add no more than eight entries, one per major gap:

1. **Oracle Fusion Cloud Financials** — Finance (1.1–1.5).
2. **SAP Ariba** — Procurement (3.1–3.4).
3. **Microsoft Purview** — Information Management (4.1–4.5).
4. **Microsoft Power BI** — Analytics (4.5).
5. **Planon** — Estates (6.1–6.5).
6. **ServiceNow ITSM** — Digital & Technology (7.1–7.6).
7. **ServiceNow GRC** — Governance & Assurance (8.3–8.6).
8. **Qualtrics** — Understanding Needs and Feedback (9.1, 9.4).

This gives the generic catalogue one credible product per major area instead of a long tail in one area. The sector catalogues (electricity, NHS, housing, etc.) remain the place for sector-specific products.

## Notes and limits

- **ServiceNow and SAP/Coupa block this environment.** Their product pages are real but return 403/000 to a script. Open them in a browser before treating them as broken or as verified.
- **A generic catalogue should not duplicate the sector catalogues.** Use it for corporate capabilities (finance, HR, procurement, information, estates, ITSM, GRC, analytics) and keep sector-specific products in the sector catalogue.
- **A `200` is not a review.** Every candidate still needs a short vendor statement, a capability match against the pinned map, and a named reviewer's date.
- **The same code-set problem remains.** The any-organisation catalogue is pinned to the any_organisation map; it does not cover electricity codes. That is a product design issue, not a content gap.
