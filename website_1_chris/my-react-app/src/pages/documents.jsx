import './documents.css'
import {useState} from 'react'

function Documents() {

    const [current, setCurrent] = useState(0);
    

    const documents = [
        { short: 'SDP', title: 'Software Development Plan', file: '/docs/software-development-plan.pdf' },
        { short: 'SRD', title: 'Software Requirements and Design Plan', file: '/docs/software-requirements-and-design.pdf' }
    ];

    const doc = documents[current];

    return (
        <div>
            <h1>Documents</h1>
            <p>Here you can view our Software Development Plan (SDP) and our Software Requirements and Design plan (SRD).</p>

            <div className="documents-tabs">
                <button
                    type="button"
                    className={current === 0 ? 'documents-tab active' : 'documents-tab'}
                    aria-pressed={current === 0}
                    onClick={() => setCurrent(0)}
                >
                    SDP
                </button>
                <button
                    type="button"
                    className={current === 1 ? 'documents-tab active' : 'documents-tab'}
                    aria-pressed={current === 1}
                    onClick={() => setCurrent(1)}
                >
                    SRD
                </button>
            </div>

            <iframe
            className="documents-viewer"
            src={doc.file}
            title={doc.title}
            />


        </div>
    )
}

export default Documents