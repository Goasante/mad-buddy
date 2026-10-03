from reportlab.platypus import SimpleDocTemplate, Paragraph, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from pathlib import Path
out=Path(__file__).resolve().parents[2] / 'public/founder/Godfred-Ofosu-Asante-CV.pdf'
out.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFontFamily('Helvetica',normal='Helvetica',bold='Helvetica-Bold',italic='Helvetica-Oblique',boldItalic='Helvetica-BoldOblique')
regular='Helvetica'; bold='Helvetica-Bold'
styles={
 'name':ParagraphStyle('name',fontName=bold,fontSize=21,leading=25,spaceAfter=5),
 'tag':ParagraphStyle('tag',fontName=regular,fontSize=10.5,leading=14,spaceAfter=7),
 'contact':ParagraphStyle('contact',fontName=regular,fontSize=9,leading=13,spaceAfter=3),
 'section':ParagraphStyle('section',fontName=bold,fontSize=11,leading=15,spaceBefore=15,spaceAfter=7),
 'role':ParagraphStyle('role',fontName=bold,fontSize=10.5,leading=14,spaceBefore=8,spaceAfter=3),
 'meta':ParagraphStyle('meta',fontName=regular,fontSize=9.5,leading=13,spaceAfter=5),
 'body':ParagraphStyle('body',fontName=regular,fontSize=10,leading=14.2,spaceAfter=5),
 'bullet':ParagraphStyle('bullet',fontName=regular,fontSize=10,leading=14.2,leftIndent=11,firstLineIndent=-9,spaceAfter=4),
}
story=[]
def p(t,k='body'):return Paragraph(t,styles[k])
def add(t,k='body'):story.append(p(t,k))
def section(t):add(t.upper(),'section')
def role(title,meta,bullets):
 story.append(KeepTogether([p(title,'role'),p(meta,'meta'),p('- '+bullets[0],'bullet')]))
 for b in bullets[1:]:add('- '+b,'bullet')
def footer(c,d):
 c.saveState();c.setStrokeColor(colors.HexColor('#cccccc'));c.setLineWidth(.4);c.line(43,36,A4[0]-43,36)
 c.setFont(regular,8);c.setFillColor(colors.HexColor('#555555'));c.drawString(43,24,'Godfred Ofosu Asante');c.drawRightString(A4[0]-43,24,str(d.page));c.restoreState()
add('GODFRED OFOSU ASANTE','name')
add('Operations, Lead Generation &amp; Digital Support','tag')
add('Accra, Ghana | +233 555 501 626','contact')
add('<link href="mailto:godfred@mad-buddy.com">godfred@mad-buddy.com</link> | <link href="mailto:godfredasante004@gmail.com">godfredasante004@gmail.com</link>','contact')
add('<link href="https://www.linkedin.com/in/goasante">linkedin.com/in/goasante</link> | <link href="https://mad-buddy.com/godfred">mad-buddy.com/godfred</link>','contact')
section('Professional Summary')
add('Operations leader and digital marketing professional with experience managing a 30-person team, coordinating client campaigns, and researching B2B and M&amp;A prospects. Built practical tools for performance tracking and workplace recognition, and founded Mad Buddy. Combines client communication, data quality, web development, and visual design with a hands-on approach to solving everyday problems.')
section('Core Skills')
add('<b>Operations &amp; client support:</b> Team supervision, campaign coordination, account management, client communication, scheduling, reporting, and workflow improvement.')
add('<b>Lead generation &amp; research:</b> B2B and M&amp;A prospecting, LinkedIn Sales Navigator, Endole, company research, data enrichment and validation, email marketing, and copywriting.')
add('<b>Digital &amp; creative:</b> Google Sheets, Microsoft Office, WordPress, Adobe Photoshop, InDesign, XD, Premiere Pro, social media management, graphic design, and video editing.')
section('Professional Experience')
role('Operations Lead | TouchForce Ltd Ghana','Accra, Ghana | August 2024 - Present',[
 'Manage day-to-day delivery for lead generation campaigns and coordinate client requirements with the team.',
 'Supervise 30 employees across account management and support functions, with responsibility for performance standards and quality control.',
 'Develop reporting and workflow systems, identify process bottlenecks, and improve communication between teams.',
 'Maintain client relationships and translate campaign data into clear performance updates.'
])
role('Business Partner | FlowmingoAI','Remote contract | September 2025 - Present',[
 'Connect businesses and candidates with an AI-powered interview platform and explain how it supports recruitment workflows.'
])
role('Senior Account Manager | TouchForce Ltd Ghana','Accra, Ghana | July 2023 - August 2024',[
 'Led account managers supporting more than 20 client accounts and coordinated tailored outreach campaigns.',
 'Researched prospects using LinkedIn Sales Navigator and Endole; arranged meetings between clients and potential business partners.',
 'Created a Google Sheets system to track employee efficiency and make daily work easier to manage.',
 'Worked with sales and marketing teams to refine targeting, maintain client communication, and improve campaign delivery.'
])
story.append(PageBreak())
section('Earlier Experience')
role('Digital Marketing &amp; Graphic Design | Sambus Geospatial Ltd','Accra, Ghana | October 2021 - October 2022',[
 'Managed social media accounts and supported content planning, newsletters, and article writing.',
 'Produced more than 200 designs for social media publications during the graphic design assignment, September - October 2022.',
 'Edited and published videos across company social platforms and contributed to online audience growth.'
])
role('Graphic Design Intern (Web Support) | Complete Farmer','Accra, Ghana | June 2018 - August 2018',[
 'Supported the web designer with image sourcing and Adobe Photoshop preparation, including background removal.',
 'Collected GPS coordinates for a farm and gained introductory experience in UI/UX design and Python.'
])
section('Selected Projects')
role('Mad Buddy | Founder &amp; Creator','Product development',[
 'Built a social app that helps people connect in real life through privacy-safe proximity, deliberate discovery, and shared plans.',
 'Work spans product design, web and mobile experiences, and ongoing application development.'
])
role('Workplace Gamification &amp; Rewards System','Operations improvement',[
 'Built a recognition system using Google Sheets records, fair competition, and team celebrations; added duplicate checks and validation as the system evolved.',
 'Reported a 65% increase in appointments and 98% active system usage after three months in a public LinkedIn project write-up.'
])
section('Education')
add('<b>Master\'s degree in Marketing - in progress</b> | University of Ghana Business School<br/>2025 - Present')
add('<b>Bachelor of Arts, Geography &amp; Resource Development and Political Science</b><br/>University of Ghana | 2017 - 2021')
section('Professional Development')
add('Cold Emailing for B2B - Udemy (2025); What is Graphic Design? - LinkedIn (2022); Graphic Design Theory - Udemy (2019). Additional study: digital marketing and UI/UX design with Figma and Adobe XD.')
section('Additional Remote-Work Capabilities')
add('Customer service and administrative support; virtual assistance and meeting scheduling; online research, data collection and data entry; AI training support through instruction following, written response review, data annotation, and quality checks.')
add('Comfortable working with structured guidelines, checking information for consistency, and communicating clearly with clients and team members.')
doc=SimpleDocTemplate(str(out),pagesize=A4,rightMargin=43,leftMargin=43,topMargin=36,bottomMargin=47,title='Godfred Ofosu Asante - Curriculum Vitae',author='Godfred Ofosu Asante',subject='Operations, Lead Generation and Digital Support',pageCompression=1)
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(out.resolve())
