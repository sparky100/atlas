# Electricity catalogue — capability gaps and candidate products

**Date:** 25 November 2026  
**Scope:** `content/capability-maps/electricity_network/4.json` (84 capabilities) against `content/catalogue/electricity_network/2.json` (19 entries).  
**Method:** joined the catalogue's capability links to the map by code; checked official vendor pages with an HTTP GET and a browser user agent on 25 November 2026. `403` and `000` mean bot protection or a network timeout, not necessarily a dead page. A `200` does not prove the page still supports a claim.

## Coverage after v2

- **17 of 84** capabilities have at least one product (13 before v2).
- **67** have no product in the electricity catalogue.
- `any_organisation` does **not** cover these: it is pinned to the `any_organisation` map and uses a different code set. A model seeded from the electricity map cannot see its entries through the catalogue lookup.

### Covered

| Capability | Products |
|---|---|
| 5 Customer Contact | Salesforce Service Cloud; Microsoft Dynamics 365 Customer Service; Oracle Utilities Customer Service and Billing |
| 5.3 Case & Request Tracking | Salesforce Service Cloud; Microsoft Dynamics 365 Customer Service |
| 5.4 Complaints & Feedback | Salesforce Service Cloud; Microsoft Dynamics 365 Customer Service |
| 5.1 Contact Channels | Genesys Cloud CX |
| 9 Asset Management | Esri ArcGIS Utility Network; GE Vernova Smallworld Geo Network Management |
| 9.1 Network Asset Health Indices | IBM Maximo Application Suite |
| 9.2 Network Investment Planning | IBM Maximo Application Suite |
| 9.4 Network Planning & Load Forecasting | Esri ArcGIS Utility Network; GE Vernova Smallworld Geo Network Management |
| 9.5 Asset Inspection & Maintenance | IBM Maximo; SAP Asset Management; Octave Attune EAM |
| 10.1 Outage & Fault Management | Schneider Electric EcoStruxure ADMS; GE Vernova GridOS for Distribution |
| 10.6 Control Room & Real-Time Operations | Schneider Electric EcoStruxure ADMS; GE Vernova GridOS for Distribution |
| 11.1 Smart Metering Data | Siemens Gridscale X Meter Data Management; Oracle Utilities Meter Data Management |
| 11.4 Connection Quotations | Microsoft Dynamics 365 Customer Service; Salesforce Energy & Utilities Cloud |
| 11.5 Billing & Settlement | Oracle Utilities Customer Service and Billing |
| 13.1 Capital Projects & Construction | Oracle Primavera Unifier; Oracle Primavera P6; Microsoft Project |
| 13.2 Planned Maintenance & Inspection | IBM Maximo; Octave Attune EAM |
| 13.3 Field Workforce Scheduling & Dispatch | Microsoft Dynamics 365 Field Service; Salesforce Field Service and Operations |

## Uncovered, by area

| Area | Uncovered |
|---|---|
| **1 Finance** | 1, 1.1–1.5 (6) |
| **2 Human Resources** | 2, 2.1–2.5 (6) |
| **3 Procurement** | 3, 3.1–3.4 (5) |
| **4 Information Management** | 4, 4.1–4.5 (6) |
| **5 Customer Contact** | 5.2 Identity & Account Verification; 5.5 Accessibility & Inclusion (2) |
| **6 Estates** | 6, 6.1–6.5 (6) |
| **7 Digital & Technology** | 7, 7.1–7.6 (7) |
| **8 Governance & Assurance** | 8, 8.1–8.6 (7) |
| **9 Asset Management** | 9.3 Substation & Circuit Condition Monitoring (1) |
| **10 Network Operations** | 10, 10.2 Connections, 10.3 Emergency Response, 10.4 Distribution System Operation, 10.5 Flexibility Markets (5) |
| **11 Customer & Metering** | 11, 11.2 Priority Services Register, 11.3 Guaranteed Standards Payments, 11.6 Vulnerable Customer Support (4) |
| **12 Regulatory Compliance** | 12, 12.1 Ofgem reporting, 12.2 RIIO business plan, 12.3 Interruptions Incentive Reporting, 12.4 Network Access & Charging, 12.5 Industry Codes Compliance, 12.6 HSE (7) |
| **13 Network Delivery** | 13, 13.4 Streetworks & Permits, 13.5 Land, Wayleaves & Consents, 13.6 Vegetation Management, 13.7 Contractor Management (5) |

**Total 67** (some parent codes are included deliberately; they are selectable in the map).

## Gaps closed in v2 by extending existing entries

These needed no new product, only a capability link the vendor page already supports:

- **5.3 Case & Request Tracking** — Salesforce Service Cloud; Microsoft Dynamics 365 Customer Service.
- **9.1 Network Asset Health Indices** — IBM Maximo (asset performance/condition).
- **9.2 Network Investment Planning** — IBM Maximo (asset investment planning).
- **13.2 Planned Maintenance & Inspection** — IBM Maximo; Octave Attune EAM.

## Sector-specific gaps with candidates

These are research shortlists, not catalogue entries. Each needs a date-stamped vendor statement, a capability match, and a named reviewer before it enters a version.

| Capability | Candidate | Official page | Status | What the page says |
|---|---|---|---|---|
| 10.2 Connections | C&C Group IDNO itC | https://web.candc-uk.com/idno-product-suite | 200 | Developments, metering points, MPANs and network connections. |
| 10.2 Connections | Advanced Infrastructure LAEP+ | https://advanced-infrastructure.co.uk/distribution-network-operators | 200 | Connections Portal for self-serve quotes and customer planning. |
| 10.2 Connections | VisNet Connect | https://visnet.tech/ | 200 | Managing increasing volumes of connection requests. |
| 10.5 Flexibility Markets | Piclo | https://piclo.com/ | 200 | Independent marketplace for energy flexibility; DNO tenders. |
| 10.5 Flexibility Markets | Electron / ElectronConnect | https://electron.net/ | not checked | Market platform for DNO flexibility; verify the product page. |
| 9.1 Asset Health Indices | DNV Cascade | https://dnv.com/services/electric-utility-asset-management-software-cascade-viewer-143263 | 403 | Asset Health Index, criticality indexing and maintenance prioritisation. Verify in a browser. |
| 9.2 Network Investment Planning | IFS Copperleaf | https://copperleaf.com/solutions-for-industry/electric-utilities-asset-investment-planning | 200 | CNAIM-based asset risk and investment planning. |
| 9.3 Substation & Circuit Condition Monitoring | Dynamic Ratings DynamicMetrix | https://dynamicratings.com/products/dynamicmetrix | 200 | Condition monitoring for transformers, circuit breakers and switchgear. |
| 9.3 Substation & Circuit Condition Monitoring | GE Vernova Asset Monitoring | https://www.gevernova.com/electrification/equipment/asset-monitoring | 200 | Monitoring and control for substation equipment. |
| 10.3 Emergency Response | Juvare | https://www.juvare.com/industry/electric-utilities/ | 200 | Incident management for electric utilities. |
| 10.3 Emergency Response | Veoci | https://veoci.com/utilities/utilities-emergency-management | not checked | Emergency management for utility operations. |
| 11.2 Priority Services Register | Zero Friction | https://zerofriction.co/uk-priority-services-register | 200 | PSR fields in a Salesforce-based system; general PSR, not DNO-specific. |
| 11.6 Vulnerable Customer Support | TellJo | https://telljo.org/ | 200 | Digital wellbeing assessments for vulnerable customers. |
| 11.6 Vulnerable Customer Support | Aryza | https://aryza.com/uk_EN/energy-and-utilities | not checked | Vulnerability and affordability support. |
| 13.4 Streetworks & Permits | Symology Aurora | https://symology.co.uk/aurora | 000 (timeout) | Street Works solution with Street Manager integration. Verify in a browser. |
| 13.4 Streetworks & Permits | Siemens Confirm | https://help.assetmanagement.siemens.com/help/Content/PDF/Confirm/v21.20/confirm-v21-20-street-works-user-manual.pdf | not checked | Street Works notices and permits. Find the product page, not the manual. |
| 13.5 Land, Wayleaves & Consents | Easetech | https://easetech.co.za/easetech/software | 200 | Online wayleave applications and approvals. Not UK-specific. |
| 13.5 Land, Wayleaves & Consents | Quorum On Demand Land | https://quorumsoftware.com/solutions/renewable-right-of-way-and-land-management | 200 | Easements, access rights, landowner agreements and permits. Not UK-specific. |
| 13.6 Vegetation Management | KaarbonTech Tree SMART | https://kaarbontech.co.uk/trees | 200 | UK tree stock surveying and risk-based management. |
| 13.6 Vegetation Management | Neara | https://neara.com/solutions/teams | not checked | Digital vegetation management for utilities. |
| 13.7 Contractor Management | Totalmobile Utility Works Management | https://totalmobile.com/software/utility-works-management | 200 | Work-order management for utility contractors and subcontractors. |
| 13.2 Planned Maintenance & Inspection | Digpro | https://digpro.com/key-functionalities-in-dppower/network-maintenance | 200 | Inspection rounds and maintenance planning for electricity networks. |
| 13.2 Planned Maintenance & Inspection | 3-GIS | https://www.3-gis.com/utilities/asset-inspection-field-operations | 200 | Asset inspection planning and field operations. |

## No clear product, or not catalogue material

- **12.1 Ofgem regulatory reporting, 12.2 RIIO business plan, 12.5 Industry Codes Compliance.** Ofgem publishes RIGs and reporting packs; these are processes and consultancy, not a vendor product. Do not force an entry.
- **12.3 Interruptions Incentive Reporting, 12.4 Network Access & Charging.** Likely part of a DNO's regulatory/finance systems or consultancy; no clear product found.
- **12.6 Health, Safety & Environment.** IBM Maximo's page mentions HSE, but the catalogue entry would need its own HSE claim before adding the link. A dedicated HSE product (Cority, Enablon, Intelex) is a candidate for a later search.
- **1–8 generic corporate capabilities.** These are shared across sectors and should be a shared catalogue, not 17 sector-specific copies. The `any_organisation` catalogue currently uses a different code set and does not solve this by itself.
- **5.2 Identity & Account Verification, 5.5 Accessibility & Inclusion.** No sector-specific product found; identity verification may be part of a CRM/CIAM platform, accessibility is a design concern rather than a catalogue product.

## EA Technology apps checked (25 November 2026)

EA Technology's "apps" are four VisNet SaaS app families (Reliability, Capacity, Quality of Supply, Local Integration), plus its separate software line. Five were added to the draft:

| Product | Capabilities | Status |
|---|---|---|
| VisNet Connect | 10.2 Connections; 11.4 Connection Quotations; 9.4 Network Planning | Added |
| VisNet Reliability Apps | 10.1 Outage & Fault Management | Added |
| VisNet Capacity Apps | 10.4 Distribution System Operation; 9.4 Network Planning | Added |
| Invest | 9.1 Asset Health Indices; 9.2 Network Investment Planning | Added |
| Astute HV Monitoring | 9.3 Condition Monitoring; 13.2 Planned Maintenance | Added |

The second wave is VisNet Design (9.4, 10.2), VisNet Forecast (9.4, 9.2), UltraTEV Plus² (9.3, 13.2) and the VisNet Hub/View/Reclose² devices (9.3, 10.1). The Power Quality app has no exact capability code in this map, so it was not forced in.

## Recommended next wave

Add no more than eight entries in the next review, so each can be checked properly:

1. **Piclo** — 10.5 Flexibility Markets.
2. **C&C Group IDNO itC** or **Advanced Infrastructure LAEP+** — 10.2 Connections (choose after reading both pages).
3. **IFS Copperleaf** — 9.2 Network Investment Planning.
4. **DNV Cascade** — 9.1 Network Asset Health Indices (verify the 403 in a browser).
5. **Dynamic Ratings DynamicMetrix** — 9.3 Substation & Circuit Condition Monitoring.
6. **KaarbonTech Tree SMART** — 13.6 Vegetation Management.
7. **Symology Aurora** — 13.4 Streetworks & Permits (verify the timeout).
8. **TellJo** — 11.6 Vulnerable Customer Support.

Then review 13.7 Contractor Management (Totalmobile) and 12.6 HSE separately.

## Verification rules for the next wave

1. Open the vendor page in a browser; a 403/000 is not proof of a broken link.
2. Quote one short, dated statement from the page in `claims`; do not infer capability from the product category alone.
3. Match the capability code and name to the pinned map version exactly.
4. Name the reviewer and the review date; a changed claim is "Pending review" until a person signs it.
5. Keep the catalogue's no-price rule in mind: a URL containing `pricing` (Microsoft Project's canonical page) cannot be used.
